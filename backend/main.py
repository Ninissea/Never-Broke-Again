import html
import json
from pathlib import Path

import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent.parent
CSV_PATH = BASE_DIR / "data" / "releve.csv"
POTS_PATH = BASE_DIR / "data" / "pots.json"

CATEGORY_COLORS = {
    "Loyer": "#B91C1C",
    "Nourriture": "#2563EB",
    "Transport": "#16A34A",
    "Loisirs": "#F59E0B",
    "Epargne Court Terme": "#9CA3AF",
    "Epargne Long Terme": "#9333EA",
    "Revenus": "#10B981",
    "Autre": "#6B7280",
}

FALLBACK_PAYLOAD = {
    "user": {"name": "Anisse", "streak": 14},
    "pots": [
        {"id": "courant", "nom": "COURANT", "sousTitre": "Compte courant", "solde": 850, "objectif": 1000},
        {"id": "epargne_courte", "nom": "EPARGNE COURTE", "sousTitre": "Fonds d'urgence", "solde": 30, "objectif": 500},
        {"id": "epargne_longue", "nom": "EPARGNE LONGUE", "sousTitre": "Cotisation WEI", "solde": 2500, "objectif": 5000},
    ],
    "budget": [
        {"categorie": "Loyer", "montant": 200, "couleur": "#B91C1C"},
        {"categorie": "Nourriture", "montant": 200, "couleur": "#2563EB"},
        {"categorie": "Transport", "montant": 55, "couleur": "#16A34A"},
        {"categorie": "Loisirs", "montant": 25, "couleur": "#F59E0B"},
        {"categorie": "Epargne Court Terme", "montant": 30, "couleur": "#9CA3AF"},
        {"categorie": "Epargne Long Terme", "montant": 100, "couleur": "#9333EA"},
    ],
    "transactions": [
        {"libelle": "AUCHAN", "montant": -5.00, "couleur": "#2563EB"},
        {"libelle": "CAFETARIA", "montant": -0.55, "couleur": "#F59E0B"},
    ],
    "insight": {
        "titre": "Sécurise ton WEI",
        "message": "Les flux de la colocation sont stables. Transfère 15 € vers le pot 'Cotisation WEI 2026' pour sécuriser l'événement et maintenir ton streak.",
        "montant": 15,
        "potSource": "courant",
        "potCible": "epargne_longue",
    },
}


class InsightModel(BaseModel):
    titre: str = Field(description="Titre court du conseil")
    message: str = Field(description="Conseil d'épargne actionnable")
    montant: float = Field(description="Montant en euros à transférer")
    potSource: str = Field(description="id du pot débité")
    potCible: str = Field(description="id du pot crédité")


class TransactionIn(BaseModel):
    label: str
    amount: float
    date: str


class InsightRequest(BaseModel):
    balance: float
    transactions: list[TransactionIn]
    pot_cible: str = "Cotisation WEI 2026"
    self_def: str | None = None


class InsightResponse(BaseModel):
    titre: str = Field(description="Titre court du conseil")
    message: str = Field(description="Conseil d'épargne actionnable")
    montant: float = Field(description="Montant en euros à transférer")
    potCible: str = Field(description="Nom du pot d'épargne cible")


class RecurringItem(BaseModel):
    label: str
    avg: float
    count: int


class FixedChargesRequest(BaseModel):
    items: list[RecurringItem]
    months: int = 1


class FixedCharge(BaseModel):
    libelle: str = Field(description="Libellé de la charge fixe, identique à celui fourni en entrée")
    montant: float = Field(description="Montant mensuel moyen de la charge")


class FixedChargesResponse(BaseModel):
    charges: list[FixedCharge] = Field(description="Liste des charges fixes mensuelles détectées")


LIVE_FALLBACK = {
    "titre": "Petit écart, grande discipline",
    "message": (
        "Cette dépense fast-food de 15€ peut être compensée immédiatement. "
        "Transfère 15€ vers ton pot 'Cotisation WEI 2026' pour rester sur la trajectoire "
        "et garder ton streak intact."
    ),
    "montant": 15,
    "potCible": "Cotisation WEI 2026",
}

LOW_BALANCE_THRESHOLD = 20

LIVE_FALLBACK_LOW_BALANCE = {
    "titre": "Stop, on freine un peu",
    "message": (
        "Ton solde est très bas en ce moment. Mets en pause les dépenses non essentielles "
        "(fast-food, sorties) le temps de laisser ton compte respirer avant de penser à épargner."
    ),
    "montant": 0,
    "potCible": "Cotisation WEI 2026",
}


FIXED_CHARGE_KEYWORDS = (
    "LOYER", "ASSURANCE", "MUTUELLE", "ABONNEMENT", "NETFLIX", "SPOTIFY", "DEEZER",
    "DISNEY", "CANAL", "EDF", "ENGIE", "VEOLIA", "FREE", "SFR", "ORANGE", "BOUYGUES",
    "INTERNET", "ICLOUD", "APPLE", "AMAZON PRIME", "SALLE DE SPORT", "BASIC FIT", "BASICFIT",
)


def fixed_charges_fallback(items: list[RecurringItem], months: int) -> list[dict]:
    """Une charge fixe revient ~1x/mois avec un montant stable (loyer, assurance,
    abonnement...). Les commerces visités plusieurs fois par mois (courses, fast-food,
    transport) ne sont PAS des charges fixes même s'ils reviennent souvent."""
    charges = []
    for item in items:
        label_up = item.label.upper()
        occurrences_per_month = item.count / max(1, months)
        is_monthly_cadence = item.count >= 2 and occurrences_per_month <= 1.5
        is_known_fixed = any(kw in label_up for kw in FIXED_CHARGE_KEYWORDS)
        if is_monthly_cadence or is_known_fixed:
            charges.append({"libelle": item.label, "montant": round(item.avg, 2)})
    return charges


def generate_fixed_charges(items: list[RecurringItem], months: int) -> dict:
    fallback = {"charges": fixed_charges_fallback(items, months)}
    if not items:
        return fallback

    template = (
        "Tu analyses les dépenses récurrentes d'un compte bancaire sur {months} mois.\n"
        "Dépenses récurrentes (libellé, montant moyen en euros, nombre d'occurrences) : {items}\n\n"
        "Identifie celles qui sont des CHARGES FIXES MENSUELLES (loyer, assurance, mutuelle, "
        "abonnements téléphone/internet/streaming, salle de sport, etc.) : des dépenses "
        "récurrentes pour un montant quasi identique chaque mois.\n"
        "Exclu les commerces simplement visités souvent (courses, restaurants, transports) "
        "qui ne sont pas des charges fixes.\n"
        "Pour chaque charge fixe retenue, garde le libellé EXACTEMENT comme fourni en entrée "
        "et indique son montant moyen.\n\n"
        "Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou "
        "après, sans raisonnement, sans bloc de code markdown.\n\n"
        "{format_instructions}"
    )
    inputs = {
        "items": json.dumps([i.model_dump() for i in items], ensure_ascii=False),
        "months": months,
    }
    return _invoke_insight_chain(FixedChargesResponse, template, ["items", "months"], inputs, fallback)


def categorize(libelle: str, montant: float) -> str:
    if montant > 0:
        return "Revenus"
    l = str(libelle).upper()
    if "LOYER" in l:
        return "Loyer"
    if any(k in l for k in ("AUCHAN", "CARREFOUR", "LIDL", "FRANPRIX", "BOULANGERIE", "UBER EATS", "CAFETARIA")):
        return "Nourriture"
    if any(k in l for k in ("ILEVIA", "SNCF", "UBER")):
        return "Transport"
    if any(k in l for k in ("SPOTIFY", "CINEMA", "STEAM", "NETFLIX")):
        return "Loisirs"
    if any(k in l for k in ("FONDS URGENCE", "EPARGNE COURTE")):
        return "Epargne Court Terme"
    if any(k in l for k in ("POT WEI", "EPARGNE LONGUE")):
        return "Epargne Long Terme"
    return "Autre"


def load_data():
    df = pd.read_csv(CSV_PATH, parse_dates=["date"])
    with open(POTS_PATH, "r", encoding="utf-8") as f:
        pots_data = json.load(f)
    return df, pots_data


def build_budget(df: pd.DataFrame) -> list[dict]:
    df = df.copy()
    df["categorie"] = df.apply(lambda r: categorize(r["libelle"], r["montant"]), axis=1)
    depenses = df[(df["montant"] < 0) & (df["categorie"] != "Revenus")]
    grouped = depenses.groupby("categorie")["montant"].sum().abs()
    return [
        {
            "categorie": cat,
            "montant": round(float(montant), 2),
            "couleur": CATEGORY_COLORS.get(cat, CATEGORY_COLORS["Autre"]),
        }
        for cat, montant in grouped.items()
    ]


def build_transactions(df: pd.DataFrame) -> list[dict]:
    df_sorted = df.sort_values("date", ascending=False).head(5)
    transactions = []
    for _, row in df_sorted.iterrows():
        cat = categorize(row["libelle"], row["montant"])
        transactions.append({
            "libelle": row["libelle"],
            "montant": round(float(row["montant"]), 2),
            "couleur": CATEGORY_COLORS.get(cat, CATEGORY_COLORS["Autre"]),
        })
    return transactions


OLLAMA_MODEL = "llama3.2:3b"
# Garde le modèle chargé en mémoire entre deux requêtes : sur CPU, le rechargement
# du modèle est souvent le principal poste de latence.
OLLAMA_KEEP_ALIVE = "30m"
# Les réponses (titre/message/montant) sont courtes, mais le JSON inclut aussi les clés/
# structure du schéma : une valeur trop basse tronque le JSON avant la fin (réponse
# imparfaite -> fallback générique, donc coût LLM payé pour rien). 400 laisse de la marge.
OLLAMA_NUM_PREDICT = 400

# Cache mémoire des réponses LLM : avec temperature=0 et seed fixe, une même entrée
# produit toujours la même sortie, donc pas besoin de re-solliciter le modèle.
_LLM_CACHE: dict[str, dict] = {}


def _make_llm():
    from langchain_community.chat_models import ChatOllama

    # temperature=0 (et seed fixe) pour des réponses reproductibles à entrée identique.
    return ChatOllama(
        model=OLLAMA_MODEL,
        temperature=0,
        seed=42,
        format="json",
        num_predict=OLLAMA_NUM_PREDICT,
        keep_alive=OLLAMA_KEEP_ALIVE,
    )


def _invoke_insight_chain(pydantic_model: type[BaseModel], template: str, input_variables: list[str], inputs: dict, fallback: dict) -> dict:
    """Construit et exécute une chaîne LangChain -> Ollama -> parser, avec anti-crash."""
    cache_key = json.dumps({"t": template, "i": inputs}, sort_keys=True, ensure_ascii=False)
    if cache_key in _LLM_CACHE:
        return _LLM_CACHE[cache_key]

    try:
        from langchain_core.output_parsers import PydanticOutputParser
        from langchain_core.prompts import PromptTemplate

        parser = PydanticOutputParser(pydantic_object=pydantic_model)
        prompt = PromptTemplate(
            template=template,
            input_variables=input_variables,
            partial_variables={"format_instructions": parser.get_format_instructions()},
        )
        chain = prompt | _make_llm() | parser

        result = chain.invoke(inputs)
        data = result.model_dump()
        if "titre" in data:
            data["titre"] = html.unescape(data["titre"])
        if "message" in data:
            data["message"] = html.unescape(data["message"])
        _LLM_CACHE[cache_key] = data
        return data
    except Exception:
        return fallback


def generate_insight(budget: list[dict], pots_data: dict, transactions: list[dict]) -> dict:
    template = (
        "Tu es un conseiller financier pour des étudiants en colocation.\n"
        "Budget mensuel par catégorie (en euros, dépenses) : {budget}\n"
        "État des pots d'épargne : {pots}\n"
        "Dernières transactions : {transactions}\n\n"
        "Donne UN SEUL conseil d'épargne actionnable, orienté vers la sécurisation "
        "du pot 'Cotisation WEI 2026' (id potCible: epargne_longue), en débitant le "
        "pot courant (id potSource: courant), SANS toucher aux dépenses vitales "
        "(Loyer, Nourriture, Transport).\n\n"
        "Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou "
        "après, sans raisonnement, sans bloc de code markdown.\n\n"
        "{format_instructions}"
    )
    inputs = {
        "budget": json.dumps(budget, ensure_ascii=False),
        "pots": json.dumps(pots_data.get("pots", []), ensure_ascii=False),
        "transactions": json.dumps(transactions, ensure_ascii=False),
    }
    return _invoke_insight_chain(InsightModel, template, ["budget", "pots", "transactions"], inputs, FALLBACK_PAYLOAD["insight"])


SELF_DEF_PROFILES = {
    "pleasure": (
        "Anisse a choisi de se faire plaisir sans culpabiliser : propose une épargne en douceur, "
        "sur les petites marges détectées, sans toucher aux sorties ou achats plaisir."
    ),
    "restrict": (
        "Anisse est prêt à se restreindre pour atteindre ses objectifs plus vite : propose une "
        "épargne plus ambitieuse en réduisant les dépenses non essentielles."
    ),
}


def generate_live_insight(balance: float, transactions: list[TransactionIn], pot_cible: str, self_def: str | None = None) -> dict:
    template = (
        "Tu es un conseiller financier pour Anisse, étudiant en colocation à 5 à Lille, "
        "qui gère un budget très serré avec des dépenses partagées.\n"
        "Solde actuel du compte courant : {balance} €\n"
        "Dernières transactions (libellé, montant en euros, date) : {transactions}\n"
        "Pot d'épargne cible : '{pot_cible}'\n"
        "Style d'épargne d'Anisse : {profile}\n\n"
        "Analyse l'évolution du solde au fil des transactions ci-dessus avant de répondre.\n"
        "- Si le solde actuel permet de mettre de côté un petit montant sans risque, donne UN SEUL "
        "conseil court et actionnable pour transférer ce montant vers le pot '{pot_cible}', "
        "sans culpabiliser l'utilisateur, sur un ton encourageant et motivant.\n"
        "- Si le solde est faible ou nul (proche de 0 € ou si les dernières dépenses l'ont fait "
        "chuter fortement), NE PROPOSE AUCUN transfert : mets montant à 0, et donne plutôt un "
        "conseil pour freiner les dépenses non essentielles (ex: fast-food, sorties) afin de "
        "reconstituer le solde, sur un ton bienveillant et sans culpabiliser.\n\n"
        "Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou "
        "après, sans raisonnement, sans bloc de code markdown.\n\n"
        "{format_instructions}"
    )
    inputs = {
        "balance": balance,
        "transactions": json.dumps([t.model_dump() for t in transactions], ensure_ascii=False),
        "pot_cible": pot_cible,
        "profile": SELF_DEF_PROFILES.get(self_def, "Anisse n'a pas encore précisé son style d'épargne, reste neutre et encourageant."),
    }
    fallback = LIVE_FALLBACK_LOW_BALANCE if balance < LOW_BALANCE_THRESHOLD else {**LIVE_FALLBACK, "potCible": pot_cible}
    result = _invoke_insight_chain(InsightResponse, template, ["balance", "transactions", "pot_cible", "profile"], inputs, fallback)

    # Le LLM (llama3.2:3b) ne respecte pas toujours la consigne "pas de transfert si solde bas" :
    # on applique un garde-fou strict en post-traitement plutôt que de lui faire confiance.
    if balance < LOW_BALANCE_THRESHOLD:
        return {**LIVE_FALLBACK_LOW_BALANCE, "potCible": pot_cible}

    # Le montant proposé ne doit jamais dépasser ce qu'il reste après le transfert.
    montant = max(0.0, min(float(result.get("montant", 0)), balance - LOW_BALANCE_THRESHOLD))
    return {**result, "montant": round(montant, 2)}


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://localhost:\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def warm_up_llm():
    """Charge le modèle Ollama en mémoire au démarrage du backend, pour que la
    première vraie requête ne paie pas le coût de chargement (gros sur CPU)."""
    try:
        _make_llm().invoke("Réponds uniquement: ok")
    except Exception:
        pass


@app.get("/api/insight")
def get_insight():
    try:
        df, pots_data = load_data()
        budget = build_budget(df)
        transactions = build_transactions(df)
        user = pots_data.get("user", FALLBACK_PAYLOAD["user"])
        pots = pots_data.get("pots", FALLBACK_PAYLOAD["pots"])
    except Exception:
        return FALLBACK_PAYLOAD

    insight = generate_insight(budget, pots_data, transactions)

    return {
        "user": user,
        "pots": pots,
        "budget": budget,
        "transactions": transactions,
        "insight": insight,
    }


@app.post("/api/insight", response_model=InsightResponse)
def post_insight(payload: InsightRequest):
    return generate_live_insight(payload.balance, payload.transactions, payload.pot_cible, payload.self_def)


@app.post("/api/fixed-charges", response_model=FixedChargesResponse)
def post_fixed_charges(payload: FixedChargesRequest):
    return generate_fixed_charges(payload.items, payload.months)

# BACK-END PYTHON — VULPIN / NEVER-BROKE-AGAIN

Tu développes le moteur d'analyse local de l'application. Architecture "Zéro Cloud" : tout tourne en local, aucune donnée financière n'est envoyée sur internet. Le back lit des fichiers locaux, agrège les données, génère un conseil via une IA locale (Ollama), et expose **un seul endpoint** que le front React appelle.

---

# 0. ENVIRONNEMENT

- Python 3.10+.
- Crée un `requirements.txt` (ou complète-le) avec : `fastapi`, `uvicorn`, `pandas`, `langchain`, `langchain-community`, `pydantic`.
- Ollama doit tourner localement avec un modèle tiré (ex : `ollama pull mistral` ou `llama3`).
- Structure :
  - `backend/main.py` → serveur FastAPI + pipeline
  - `data/releve.csv` → transactions (FOURNI)
  - `data/pots.json` → état des pots + utilisateur (FOURNI)
- Lancement : `uvicorn backend.main:app --reload --port 8000`.

---

# 1. FORMAT DES FICHIERS D'ENTRÉE (déjà fournis)

## `data/releve.csv`
Colonnes : `date` (YYYY-MM-DD), `libelle` (texte), `montant` (float ; **négatif = dépense**, positif = revenu).

## `data/pots.json`
Contient `user` (`name`, `streak`) et la liste `pots` (`id`, `nom`, `sousTitre`, `solde`, `objectif`).

---

# 2. PIPELINE D'EXÉCUTION (au démarrage + à chaque appel)

1. **Lecture** : lis `data/releve.csv` avec pandas et `data/pots.json`. **Bloc `try/except` obligatoire** : si un fichier est absent/corrompu, bascule sur les données de secours hardcodées (§5).
2. **Catégorisation par mots-clés** (c'est le rôle du moteur, pas une colonne du CSV). Mappe chaque `libelle` vers une catégorie via des règles simples (insensible à la casse) :
   - `LOYER` → **Loyer**
   - `AUCHAN`, `CARREFOUR`, `LIDL`, `FRANPRIX`, `BOULANGERIE`, `UBER EATS`, `CAFETARIA` → **Nourriture**
   - `ILEVIA`, `SNCF`, `UBER` (sans EATS) → **Transport**
   - `SPOTIFY`, `CINEMA`, `STEAM`, `NETFLIX` → **Loisirs**
   - `FONDS URGENCE`, `EPARGNE COURTE` → **Epargne Court Terme**
   - `POT WEI`, `EPARGNE LONGUE` → **Epargne Long Terme**
   - revenus (montant > 0) → **Revenus** (exclus du camembert budget)
   - reste → **Autre**
3. **Agrégation** :
   - `budget` = somme des dépenses (valeur absolue) par catégorie, hors Revenus.
   - `transactions` = les 2 à 5 dernières lignes du CSV (par date décroissante).
   - `pots` = repris de `pots.json`.
4. **Inférence IA** : via LangChain + Ollama, génère un conseil personnalisé à partir des données agrégées (voir §3).
5. **Exposition** : renvoie **tout** dans un seul payload JSON (§4) sur `GET /api/insight`.

---

# 3. INFÉRENCE IA (LangChain + Ollama)

- Utilise un **Prompt Template métier** strict : injecte le budget agrégé, l'état des pots et les dernières transactions, et demande UN conseil d'épargne actionnable orienté "sécuriser le WEI 2026 sans toucher aux dépenses vitales".
- Force une sortie JSON propre via **`StructuredOutputParser`** (ou `PydanticOutputParser`) avec exactement ces champs :
  - `titre` (string court)
  - `message` (string, le conseil)
  - `montant` (number, € à transférer)
  - `potSource` (string, id du pot débité — ex `courant`)
  - `potCible` (string, id du pot crédité — ex `epargne_longue`)
- **Anti-crash (CRITIQUE pour le pitch)** : entoure toute l'inférence d'un `try/except`. Si Ollama ne répond pas, hallucine, ou si le parsing échoue, **charge silencieusement l'insight de secours** (§5). L'interface ne doit JAMAIS planter devant le jury.

---

# 4. CONTRAT DE SORTIE — `GET /api/insight` (à respecter À LA LETTRE)

Le front consomme exactement cette structure. Ne change pas les noms de clés.

```json
{
  "user": { "name": "Anisse", "streak": 14 },
  "pots": [
    { "id": "courant", "nom": "COURANT", "sousTitre": "Compte courant", "solde": 850, "objectif": 1000 },
    { "id": "epargne_courte", "nom": "EPARGNE COURTE", "sousTitre": "Fonds d'urgence", "solde": 30, "objectif": 500 },
    { "id": "epargne_longue", "nom": "EPARGNE LONGUE", "sousTitre": "Cotisation WEI", "solde": 2500, "objectif": 5000 }
  ],
  "budget": [
    { "categorie": "Loyer",              "montant": 200, "couleur": "#B91C1C" },
    { "categorie": "Nourriture",         "montant": 200, "couleur": "#2563EB" },
    { "categorie": "Transport",          "montant": 55,  "couleur": "#16A34A" },
    { "categorie": "Loisirs",            "montant": 25,  "couleur": "#F59E0B" },
    { "categorie": "Epargne Court Terme","montant": 30,  "couleur": "#9CA3AF" },
    { "categorie": "Epargne Long Terme", "montant": 100, "couleur": "#9333EA" }
  ],
  "transactions": [
    { "libelle": "AUCHAN",    "montant": -5.00,  "couleur": "#2563EB" },
    { "libelle": "CAFETARIA", "montant": -0.55,  "couleur": "#F59E0B" }
  ],
  "insight": {
    "titre": "Sécurise ton WEI",
    "message": "Les flux de la colocation sont stables. Transfère 15 € vers le pot 'Cotisation WEI 2026' pour sécuriser l'événement et maintenir ton streak.",
    "montant": 15,
    "potSource": "courant",
    "potCible": "epargne_longue"
  }
}
```

Les couleurs des catégories sont calculées côté back (le front se contente de les afficher) — c'est ce qui garde le camembert lisible malgré la DA dorée.

---

# 5. DONNÉES DE SECOURS (hardcodées)

Si la lecture des fichiers OU l'inférence échoue, renvoie ce payload de secours (identique à l'exemple §4 ci-dessus). Le but : la démo affiche toujours quelque chose de cohérent, même hors-ligne ou si Ollama plante.

---

# 6. CORS & TUNNEL

- Active **CORS** pour autoriser le front Vite (`http://localhost:5173`) à appeler `http://localhost:8000`.
- Si le front est déployé (Netlify) pendant que le back tourne en local, expose le port 8000 via **Ngrok** (tunnel HTTPS) et communique l'URL au front.

---

# 7. LIVRABLE

Crée `backend/main.py` complet et fonctionnel, lance-le, et confirme que `GET http://localhost:8000/api/insight` renvoie bien le payload du §4 à partir des fichiers `data/`.

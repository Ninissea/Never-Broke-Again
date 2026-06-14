# PROJET : VULPIN / NEVER-BROKE-AGAIN — Front-end

Tu développes le Front-end d'une application d'éducation financière et de lissage budgétaire en marque blanche B2B2C. L'architecture est "Zéro Cloud" : le Front React interagit avec une IA 100% locale (Python/Ollama/LangChain) via l'endpoint `/api/insight`. Objectif : gamification de l'épargne (Streak) + éducation financière.

---

# 0. ÉTAPE PRÉALABLE OBLIGATOIRE — VÉRIFICATION DE L'ENVIRONNEMENT

Avant d'écrire la moindre ligne, **vérifie et n'installe que ce qui manque** :

1. Confirme que Vite + React tournent (`package.json`, dossier `src/`).
2. Confirme que **Tailwind CSS** est installé ET configuré (`tailwind.config.js` + directives `@tailwind` dans le CSS d'entrée). Sinon, configure-le.
3. Vérifie/installe (ne réinstalle pas si déjà présent) :
   - `react-router-dom` (navigation 4 pages — **probablement absent**)
   - `lucide-react`, `react-confetti`
   - `shadcn/ui` si utilisé
4. Lance `npm run dev` à la fin pour confirmer que le build passe sans erreur.

Signale-moi clairement ce qui manquait.

---

# 1. DIRECTION ARTISTIQUE — RÈGLE DE PRIORITÉ (LIRE EN PREMIER)

La maquette `maquette.png` sert **UNIQUEMENT de référence pour la DISPOSITION**. **IGNORE ses couleurs** (orange/blanc). Applique le **Dark Mode "Carte Black"**, qui prime sur tout :

| Élément | Valeur |
|---|---|
| Fond principal | `bg-[#0B1D51]` (bleu roi) |
| Texte | `text-[#D4AF37]` (doré) |
| Bordures | `border-2 border-[#D4AF37]` |
| Conteneurs | fond `#0B1D51` ou transparent, bordure dorée |

**Exception — camembert Budget :** garde les couleurs de catégorie **fournies par l'API** (champ `couleur`) pour rester lisible. Tout le reste reste doré sur bleu.

---

# 2. SOURCE DE DONNÉES — TOUT VIENT DE L'API (POINT CLÉ)

⚠️ **Aucune valeur en dur dans l'UI.** Toutes les données (utilisateur, streak, pots, budget, transactions, insight) proviennent d'un **seul appel** : `GET http://localhost:8000/api/insight`.

- Au montage de l'app, fetch cet endpoint et stocke le résultat dans un `useState` global (ou contexte).
- **Bloc `try/catch` OBLIGATOIRE** : si l'API ne répond pas, charge un **JSON de secours hardcodé** (copie exactement la structure ci-dessous) pour que la démo reste fonctionnelle hors-ligne.

### Structure exacte reçue (le front s'adapte à ces clés) :
```json
{
  "user": { "name": "Utilisateur", "streak": 14 },
  "pots": [
    { "id": "courant", "nom": "COURANT", "sousTitre": "Compte courant", "solde": 850, "objectif": 1000 },
    { "id": "epargne_courte", "nom": "EPARGNE COURTE", "sousTitre": "Fonds d'urgence", "solde": 30, "objectif": 500 },
    { "id": "epargne_longue", "nom": "EPARGNE LONGUE", "sousTitre": "Objectif long terme", "solde": 2500, "objectif": 5000 }
  ],
  "budget": [
    { "categorie": "Loyer", "montant": 200, "couleur": "#B91C1C" },
    { "categorie": "Nourriture", "montant": 200, "couleur": "#2563EB" },
    { "categorie": "Transport", "montant": 55, "couleur": "#16A34A" },
    { "categorie": "Loisirs", "montant": 25, "couleur": "#F59E0B" },
    { "categorie": "Epargne Court Terme", "montant": 30, "couleur": "#9CA3AF" },
    { "categorie": "Epargne Long Terme", "montant": 100, "couleur": "#9333EA" }
  ],
  "transactions": [
    { "libelle": "AUCHAN", "montant": -5.00, "couleur": "#2563EB" },
    { "libelle": "CAFETARIA", "montant": -0.55, "couleur": "#F59E0B" }
  ],
  "insight": {
    "titre": "Sécurise ton épargne",
    "message": "Tes flux sont stables ce mois-ci. Transfère 15 € vers ton pot d'épargne long terme pour avancer vers ton objectif et maintenir ton streak.",
    "montant": 15, "potSource": "courant", "potCible": "epargne_longue"
  }
}
```
Mets l'URL de l'API dans une variable d'env (`VITE_API_URL`) avec fallback `http://localhost:8000`.

---

# 3. STRUCTURE GÉNÉRALE & NAVIGATION (MULTI-PAGES)

Conteneur racine PWA : `max-w-md mx-auto min-h-screen bg-[#0B1D51] text-[#D4AF37] pb-24 relative`.

Routing `react-router-dom`, **4 pages** via la bottom nav (§8) :
1. `/` → **ÉPARGNE** (dashboard, §4 à §7)
2. `/statistiques`, 3. `/formation`, 4. `/compte`

Header + bottom nav partagés sur toutes les pages (layout commun).

**Le code React vit dans le dossier `frontend/`.** Organisation (pas de monolithe) :
- `frontend/src/App.jsx` → routing + layout
- `frontend/src/pages/` → `Epargne.jsx`, `Statistiques.jsx`, `Formation.jsx`, `Compte.jsx`
- `frontend/src/components/` → `InsightCard`, `PotCard`, `WeeklyCalendar`, `BudgetChart`, etc.
- `frontend/src/api.js` → fetch `/api/insight` + fallback JSON

---

# 4. PAGE ACCUEIL (ÉPARGNE)

## 4.1 Header — depuis `user`
- "Salut, {user.name} !" (→ "Salut, Camille !")
- Streak mis en valeur : `🔥 {user.streak} Jours`.

## 4.2 Calendrier hebdomadaire
Sous le header : pastilles L M M J V S D (bordure dorée). Les jours tenus sont marqués (flamme/fond doré). C'est le cœur visuel du Streak (style Duolingo).

## 4.3 Insight Card IA (CRITIQUE) — depuis `insight`
Boîte dynamique (bordure dorée marquée) affichant `insight.message`. Bouton **"Transférer"**.
**Au clic (effet Wow) :**
1. déclenche `react-confetti` ;
2. met à jour les `useState` des pots : retire `insight.montant` du pot `insight.potSource`, l'ajoute au pot `insight.potCible` (soldes ET jauges mis à jour visuellement) ;
3. désactive/masque l'insight une fois l'action faite.

## 4.4 Pots d'épargne — depuis `pots`
Slider horizontal (`overflow-x-auto`), une carte par pot (bordure dorée) : `nom`, `sousTitre`, `solde €`, et **jauge** = `solde / objectif`. Les soldes sont en `useState` car modifiés par §4.3.

## 5. Budget — depuis `budget`
Carte "Budget" (bordure dorée), 2 colonnes :
- gauche : camembert CSS (`conic-gradient`) construit dynamiquement à partir des `montant` et `couleur` de chaque catégorie ;
- droite : légende = une ligne par catégorie avec pastille `couleur` + `categorie` + `montant €`.

## 6. Dernières transactions — depuis `transactions`
Zone bordure dorée : une ligne par transaction (pastille `couleur` + `libelle` + `montant €`).

## 7. Mascotte Renard
`div` bordure dorée **pointillée** (`border-dashed`) en bas à gauche, au-dessus de la nav, texte "Mascotte Renard".

---

# 8. BOTTOM NAVIGATION (toutes les pages)
`fixed bottom-0 w-full max-w-md bg-[#0B1D51] border-t-2 border-[#D4AF37] p-2`. 4 boutons (icône `lucide-react` + texte) qui **naviguent** et marquent l'onglet actif :
| Icône | Label | Route |
|---|---|---|
| `Euro` | EPARGNE | `/` |
| `Percent` | STATISTIQUES | `/statistiques` |
| `LayoutDashboard` | FORMATION | `/formation` |
| `User` | COMPTE | `/compte` |

---

# 9. CONTENU DES 3 AUTRES PAGES (même DA, header + nav partagés)
- **STATISTIQUES** : titre + 2-3 cartes de stats (ex "Économisé ce mois : 80 €", "Respect du budget : 92 %") + une barre de progression.
- **FORMATION** : titre + 3-4 modules en cartes dorées cliquables ("Gérer son budget", "Comprendre l'épargne", "Initiation à l'investissement").
- **COMPTE** : titre + nom de l'utilisateur + réglages fictifs (Profil, Sécurité, Déconnexion).

---

# INSTRUCTIONS FINALES
- Interface impeccable pour démo B2B, mobile-first strict.
- **Zéro valeur en dur** : tout vient de l'API, avec fallback `try/catch`.
- Vérifie que l'Insight Card modifie bien les `useState` (effet Wow jury).
- À la fin : lance le projet, confirme le build sans erreur, liste les fichiers créés/modifiés.

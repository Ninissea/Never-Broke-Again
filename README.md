# Vulpin

Application d'éducation financière "Zéro Cloud" : un tableau de bord React analyse ton relevé bancaire (CSV) et un conseiller IA local (Ollama, via LangChain) propose des conseils d'épargne personnalisés. Aucune donnée financière ne quitte la machine.

## Structure du projet

```
.
├── backend/            FastAPI + LangChain/Ollama — moteur d'analyse local
│   ├── main.py         endpoints GET/POST /api/insight
│   └── requirements.txt
├── data/                données de démo lues par le backend (releve.csv, pots.json)
├── src/                 frontend TanStack Start (React 19 + Tailwind v4 + shadcn/ui)
│   ├── routes/          pages (file-based routing : index.tsx, app.tsx, __root.tsx)
│   ├── lib/             parsing CSV (csv-engine.ts), helpers
│   ├── components/      composants UI partagés
│   └── assets/          images (mascotte renard, etc.)
└── docs/                cahiers des charges d'origine (front/back)
```

## Lancement

### 1. Backend (FastAPI + Ollama)

Prérequis : Python 3.10 (numpy/pandas ne sont pas compatibles avec Python 3.11 dans cet environnement) et Ollama lancé localement avec le modèle `llama3.2:3b`.

```bash
cd backend
"/c/Program Files/Python310/python.exe" -m pip install -r requirements.txt
"/c/Program Files/Python310/python.exe" -m uvicorn main:app --reload --port 8000
```

### 2. Frontend (TanStack Start / Vite)

```bash
npm install
npm run dev
```

L'app est servie sur `http://localhost:8080` et appelle le backend sur `http://localhost:8000`.

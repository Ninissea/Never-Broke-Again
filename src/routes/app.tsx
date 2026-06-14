import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { parseCsv, type Transaction } from "@/lib/csv-engine";
import foxAdvisor from "@/assets/fox-advisor.png";
import foxDepensier from "@/assets/Renard_depensier.png";
import foxEconome from "@/assets/Renard_Econome.png";
import foxRaisonnable from "@/assets/Renard_raisonnable.png";

import {
  Upload,
  Lock,
  ArrowLeft,
  ArrowRight,
  PiggyBank,
  GraduationCap,
  BarChart3,
  User,
  Sparkles,
  Target,
  Wallet,
  BookOpen,
  Bell,
  Calendar,
  Flame,
  Check,
  X,
} from "lucide-react";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Mon Tableau de bord — Vulpin" },
      { name: "description", content: "Analyse 100% locale de ton relevé bancaire." },
    ],
  }),
  component: AppDashboard,
});

// ---------- Types & helpers ----------
type BudgetCat = "Nourriture" | "Transport" | "Loisirs" | "Shopping" | "Autre";

const CAT_COLORS: Record<BudgetCat, string> = {
  Nourriture: "#3b9eff",
  Transport: "#52b04a",
  Loisirs: "#f0a020",
  Shopping: "#a83bb3",
  Autre: "#8a8a8a",
};

// Le loyer (et les autres charges fixes) sont gérés séparément du budget piloté :
// ils sont déduits directement du revenu disponible (voir fixedChargesMonthlyTotal).
function mapToBudgetCat(t: Transaction): BudgetCat | null {
  if (t.amount >= 0) return null;
  switch (t.category) {
    case "Loyer & Charges":
      return null;
    case "Courses":
    case "Restaurants & Bars":
      return "Nourriture";
    case "Transport":
      return "Transport";
    case "Loisirs":
      return "Loisirs";
    case "Shopping":
    case "Abonnements":
      return "Shopping";
    default:
      return "Autre";
  }
}

type SavingsGoal = {
  id: string;
  name: string;
  target: number;
  deadline: string;
  saved: number;
  pinned: boolean;
};
type SelfDef = "pleasure" | "restrict";
type SpenderProfile = "depensier" | "raisonnable" | "econome";
type TabId = "epargne" | "stats" | "analyse" | "formation" | "compte";
type InsightData = { titre: string; message: string; montant: number; potCible: string };
type BudgetAdvice = {
  titre: string;
  message: string;
  budget: { categorie: string; montant: number }[];
  conseils: string[];
};

const LS_KEYS = {
  shortGoals: "nba.shortGoals",
  longGoals: "nba.longGoals",
  selfDef: "nba.selfDef",
};

const PROFILE_LABEL: Record<SpenderProfile, string> = {
  depensier: "Renard dépensier",
  raisonnable: "Renard raisonnable",
  econome: "Renard économe",
};

const PROFILE_COLOR: Record<SpenderProfile, string> = {
  depensier: "#e94560",
  raisonnable: "#3b9eff",
  econome: "#52b04a",
};

const PROFILE_IMAGE: Record<SpenderProfile, string> = {
  depensier: foxDepensier,
  econome: foxEconome,
  raisonnable: foxRaisonnable,
};

function detectProfile(income: number, expense: number): SpenderProfile {
  if (income <= 0) return "raisonnable";
  const ratio = (income - expense) / income;
  if (ratio < 0.1) return "depensier";
  if (ratio < 0.25) return "raisonnable";
  return "econome";
}

function useLS<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  const set = (nv: T) => {
    setV(nv);
    try {
      localStorage.setItem(key, JSON.stringify(nv));
    } catch {
      // quota dépassé ou stockage indisponible : on garde l'état en mémoire seulement
    }
  };
  return [v, set];
}

function fmt(n: number) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  return abs >= 1000 ? `${sign}${(abs / 1000).toFixed(1).replace(".", ",")}k€` : `${Math.round(n)}€`;
}

// Liste d'objectifs d'épargne (court/long terme). Par défaut, aucun objectif n'est présent :
// l'utilisateur les crée lui-même depuis ses portefeuilles d'épargne.
function useGoalsLS(key: string): [SavingsGoal[], (v: SavingsGoal[]) => void] {
  const [v, setV] = useState<SavingsGoal[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const set = (nv: SavingsGoal[]) => {
    setV(nv);
    try {
      localStorage.setItem(key, JSON.stringify(nv));
    } catch {
      // quota dépassé ou stockage indisponible : on garde l'état en mémoire seulement
    }
  };
  return [v, set];
}

// Clé "YYYY-MM" identifiant le mois d'une transaction.
function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTH_NAMES[+m - 1]} ${y}`;
}

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

// ---------- Computed dashboard data ----------
type MonthRow = {
  key: string;
  label: string;
  saved: number;
  spent: number;
  income: number;
  cats: Record<BudgetCat, number>;
};

type Computed = {
  income: number;
  expense: number;
  recent: Transaction[];
  baseline: Record<BudgetCat, number>;
  monthlyBudget: Record<BudgetCat, number>;
  monthlyDisposable: number;
  currentMonth: Record<BudgetCat, number>;
  currentMonthSaved: number;
  currentMonthDay: number;
  currentMonthDays: number;
  months: MonthRow[];
  streak: number;
  pastIncome: number;
  pastExpense: number;
};

const emptyCats = (): Record<BudgetCat, number> => ({
  Nourriture: 0,
  Transport: 0,
  Loisirs: 0,
  Shopping: 0,
  Autre: 0,
});

// Normalise un libellé de transaction pour le regroupement / la correspondance "charges fixes"
function normalizeLabel(label: string): string {
  return label
    .replace(/\s{2,}.*$/, "")
    .trim()
    .toUpperCase()
    .slice(0, 32);
}

// Fusionne un nouvel import de transactions avec l'historique déjà importé, en ignorant
// les doublons (même date + libellé + montant) afin de pouvoir charger plusieurs relevés
// au fil du temps sans perdre ni dupliquer l'analyse précédente.
function mergeTransactions(existing: Transaction[], incoming: Transaction[]): Transaction[] {
  const seen = new Set(existing.map((t) => `${t.date.getTime()}|${t.label}|${t.amount}`));
  const additions: Transaction[] = [];
  for (const t of incoming) {
    const sig = `${t.date.getTime()}|${t.label}|${t.amount}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    additions.push({ ...t, id: `tx-${existing.length + additions.length}-${sig}` });
  }
  return [...existing, ...additions].sort((a, b) => b.date.getTime() - a.date.getTime());
}

// Une charge fixe revient ~1x/mois avec un montant stable (loyer, abonnement...) ; un
// commerce visité plusieurs fois par mois (courses, fast-food...) n'en est pas une.
// Utilisé en réponse immédiate (avant la réponse du LLM, potentiellement lente) et en
// secours si l'appel au backend échoue.
function heuristicFixedCharges(
  items: { label: string; avg: number; count: number }[],
  months: number,
): { libelle: string; montant: number }[] {
  return items
    .filter((i) => i.count >= 2 && i.count / months <= 1.5)
    .map((i) => ({ libelle: i.label, montant: Math.round(i.avg * 100) / 100 }));
}

// Repère les dépenses récurrentes (même libellé revenant plusieurs fois) à soumettre au LLM
// pour qu'il détermine lesquelles sont des charges fixes mensuelles.
function fixedChargeCandidates(txs: Transaction[]): {
  items: { label: string; avg: number; count: number }[];
  months: number;
} {
  const months = new Set(txs.map((t) => `${t.date.getFullYear()}-${t.date.getMonth()}`));
  const map = new Map<string, { total: number; count: number }>();
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const key = normalizeLabel(t.label);
    const e = map.get(key) ?? { total: 0, count: 0 };
    e.total += Math.abs(t.amount);
    e.count += 1;
    map.set(key, e);
  }
  const items = [...map.entries()]
    .filter(([, v]) => v.count >= 2)
    .map(([label, v]) => ({ label, avg: v.total / v.count, count: v.count }));
  return { items, months: Math.max(1, months.size) };
}

function compute(
  txs: Transaction[],
  fixedChargeLabels: Set<string> = new Set(),
  fixedChargesMonthlyTotal = 0,
  monthlySavingsGoal = 0,
): Computed {
  const income = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const recent = [...txs].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 30);

  // Le budget mensuel (mois, baseline, catégories) exclut les charges fixes mensuelles
  // (loyer, abonnements, assurances...) : elles ne sont pas pilotables au jour le jour.
  const budgetTxs = txs.filter((t) => !fixedChargeLabels.has(normalizeLabel(t.label)));

  const byMonth = new Map<string, Transaction[]>();
  for (const t of budgetTxs) {
    const k = monthKey(t.date);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k)!.push(t);
  }
  const sortedKeys = [...byMonth.keys()].sort();

  const months: MonthRow[] = sortedKeys.map((k) => {
    const arr = byMonth.get(k)!;
    const inc = arr.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const exp = arr.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const cats = emptyCats();
    for (const t of arr) {
      const c = mapToBudgetCat(t);
      if (c) cats[c] += Math.abs(t.amount);
    }
    return {
      key: k,
      label: monthLabel(k),
      income: inc,
      spent: exp,
      saved: inc - exp,
      cats,
    };
  });

  const baseline = emptyCats();
  const pastKeys = sortedKeys.slice(0, -1);
  for (const k of pastKeys) {
    for (const t of byMonth.get(k)!) {
      const c = mapToBudgetCat(t);
      if (!c) continue;
      baseline[c] += Math.abs(t.amount);
    }
  }
  const n = Math.max(1, pastKeys.length);
  (Object.keys(baseline) as BudgetCat[]).forEach((c) => (baseline[c] = baseline[c] / n));

  const currentMonth = emptyCats();
  let currentMonthSaved = 0;
  if (months.length > 0) {
    Object.assign(currentMonth, months[months.length - 1].cats);
    currentMonthSaved = months[months.length - 1].saved;
  }
  if (pastKeys.length === 0) Object.assign(baseline, currentMonth);

  // Budget mensuel "plan" : ce qu'il reste chaque mois une fois le salaire amputé des charges
  // fixes et de l'objectif d'épargne, réparti entre catégories selon les proportions observées
  // historiquement (baseline).
  const txMonths = new Set(txs.map((t) => monthKey(t.date)));
  const monthlyIncome = income / Math.max(1, txMonths.size);
  const monthlyDisposable = Math.max(0, monthlyIncome - fixedChargesMonthlyTotal - monthlySavingsGoal);
  const baselineTotal = (Object.values(baseline) as number[]).reduce((s, v) => s + v, 0);
  const monthlyBudget = emptyCats();
  (Object.keys(baseline) as BudgetCat[]).forEach((c) => {
    monthlyBudget[c] = baselineTotal > 0 ? monthlyDisposable * (baseline[c] / baselineTotal) : 0;
  });

  // Position dans le mois en cours, basée sur la dernière transaction du relevé (et non
  // la date du jour) : on simule comme si "aujourd'hui" était ce dernier jour connu.
  let currentMonthDay = 1;
  let currentMonthDays = 30;
  if (budgetTxs.length > 0) {
    const maxDate = budgetTxs.reduce((max, t) => (t.date > max ? t.date : max), budgetTxs[0].date);
    currentMonthDay = maxDate.getDate();
    currentMonthDays = daysInMonth(maxDate.getFullYear(), maxDate.getMonth());
  }

  // Le profil de dépense (dépensier/raisonnable/économe) et la "streak" sont établis à partir
  // des mois précédents déjà bouclés (hors mois en cours, encore incomplet).
  const completedMonths = months.slice(0, -1);
  const pastIncome = completedMonths.length
    ? completedMonths.reduce((s, m) => s + m.income, 0)
    : income;
  const pastExpense = completedMonths.length
    ? completedMonths.reduce((s, m) => s + m.spent, 0)
    : expense;

  // La streak est un compteur d'usage de l'application (mois consécutifs d'épargne réussie
  // *depuis le démarrage avec le Renard*) : elle démarre toujours à 0, indépendamment de
  // l'historique des relevés importés pour établir le profil.
  const streak = 0;

  return {
    income,
    expense,
    recent,
    baseline,
    monthlyBudget,
    monthlyDisposable,
    currentMonth,
    currentMonthSaved,
    currentMonthDay,
    currentMonthDays,
    months,
    streak,
    pastIncome,
    pastExpense,
  };
}

// ---------- SVG Donut with predefined zones + shrinking light part ----------
type Slice = { label: string; color: string; total: number; filled: number };

function Donut({
  slices,
  size = 260,
  thickness = 46,
  center,
}: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  center?: React.ReactNode;
}) {
  const cx = size / 2,
    cy = size / 2;
  const rOuter = size / 2 - 4;
  const rInner = rOuter - thickness;
  const totalSum = slices.reduce((s, x) => s + Math.max(0, x.total), 0) || 1;
  let cursor = -Math.PI / 2;

  const arc = (a0: number, a1: number, ro: number, ri: number) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x0o, y0o] = p(ro, a0);
    const [x1o, y1o] = p(ro, a1);
    const [x0i, y0i] = p(ri, a1);
    const [x1i, y1i] = p(ri, a0);
    return `M ${x0o} ${y0o} A ${ro} ${ro} 0 ${large} 1 ${x1o} ${y1o} L ${x0i} ${y0i} A ${ri} ${ri} 0 ${large} 0 ${x1i} ${y1i} Z`;
  };

  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices.map((s, i) => {
          const span = (Math.max(0, s.total) / totalSum) * Math.PI * 2;
          if (span < 0.001) return null;
          const a0 = cursor;
          const a1 = cursor + span;
          const ratio = Math.max(0, Math.min(1, s.total > 0 ? s.filled / s.total : 0));
          const aMid = a0 + span * ratio;
          cursor = a1;
          return (
            <g key={`${s.label}-${i}`}>
              {ratio > 0 && (
                <path d={arc(a0, aMid, rOuter, rInner)} fill={s.color} opacity={0.95} />
              )}
              {ratio < 1 && (
                <path d={arc(aMid, a1, rOuter, rInner)} fill={s.color} opacity={0.22} />
              )}
              <path d={arc(a0, a1, rOuter, rOuter - 1)} fill="rgba(255,255,255,0.2)" />
            </g>
          );
        })}
      </svg>
      {center && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {center}
        </div>
      )}
    </div>
  );
}

function buildSlices(
  cats: Record<BudgetCat, number>,
  consumed: Record<BudgetCat, number>,
  savingsShort: { target: number; filled: number },
  savingsLong: { target: number; filled: number },
): Slice[] {
  const order: BudgetCat[] = ["Nourriture", "Transport", "Loisirs", "Shopping", "Autre"];
  const out: Slice[] = order
    .filter((c) => cats[c] > 0.5)
    .map((c) => ({
      label: c,
      color: CAT_COLORS[c],
      total: cats[c],
      filled: Math.min(cats[c], consumed[c] || 0),
    }));
  if (savingsShort.target > 0.5) {
    out.push({
      label: "Épargne courte",
      color: "#e94560",
      total: savingsShort.target,
      filled: Math.min(savingsShort.target, Math.max(0, savingsShort.filled)),
    });
  }
  if (savingsLong.target > 0.5) {
    out.push({
      label: "Épargne longue",
      color: "#a83bb3",
      total: savingsLong.target,
      filled: Math.min(savingsLong.target, Math.max(0, savingsLong.filled)),
    });
  }
  return out;
}

// Objectif d'épargne mensuel dérivé des objectifs de l'utilisateur (somme sur tous les objectifs
// d'une catégorie court/long terme).
function monthlySavingsTarget(goals: SavingsGoal[]): number {
  const now = Date.now();
  const perMonth = (g: SavingsGoal) => {
    if (!g.target || g.target <= g.saved) return 0;
    const remaining = g.target - g.saved;
    if (!g.deadline) return remaining / 12;
    const ms = new Date(g.deadline).getTime() - now;
    const monthsLeft = Math.max(1, Math.ceil(ms / (30.44 * 86400000)));
    return remaining / monthsLeft;
  };
  return goals.reduce((s, g) => s + perMonth(g), 0);
}

// Répartit le montant épargné ce mois-ci entre les zones court/long du camembert :
// la zone "court terme" se remplit en priorité, le surplus va sur le "long terme".
function splitSavingsFilled(
  saved: number,
  shortTarget: number,
  longTarget: number,
): { short: number; long: number } {
  const short = Math.min(saved, shortTarget);
  const long = Math.min(Math.max(0, saved - short), longTarget);
  return { short, long };
}

// L'objectif épinglé est mis en avant (carte, transferts automatiques) ; à défaut, le premier de la liste.
function pinnedOrFirst(goals: SavingsGoal[]): SavingsGoal | null {
  return goals.find((g) => g.pinned) ?? goals[0] ?? null;
}

// ---------- Root ----------
function AppDashboard() {
  const navigate = useNavigate();
  // Relevés des mois précédents (1ère page d'onboarding), utilisés pour établir le profil
  // de dépense. `txs` (relevés précédents + mois actuel fusionnés) n'est défini qu'une fois
  // la 2ème page d'onboarding complétée.
  const [pastTxs, setPastTxs] = useState<Transaction[] | null>(null);
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  // Relevé du mois actuel (étape 2 de l'onboarding, fichier unique) : sert exclusivement au
  // solde disponible ("Dépenses courantes") et au camembert du budget du mois, indépendamment
  // de l'historique fusionné `txs` utilisé pour les statistiques et le profil.
  const [currentTxs, setCurrentTxs] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Affiche la zone de dépôt par-dessus le tableau de bord existant, pour ajouter un
  // nouveau relevé sans perdre l'analyse déjà importée (cf. handleFiles : fusion).
  const [showDropZone, setShowDropZone] = useState(false);
  const [tab, setTab] = useState<TabId>("epargne");
  const [walletOpen, setWalletOpen] = useState<null | "courant" | "court" | "long">(null);
  const [introDone, setIntroDone] = useState(false);
  const [selfDef, setSelfDef] = useLS<SelfDef | null>(LS_KEYS.selfDef, null);
  const [shortGoals, setShortGoals] = useGoalsLS(LS_KEYS.shortGoals);
  const [longGoals, setLongGoals] = useGoalsLS(LS_KEYS.longGoals);
  // Étape "au moins 1 objectif d'épargne" de l'onboarding : déjà acquise si l'utilisateur a
  // déjà des objectifs enregistrés (ex. session précédente).
  const [goalsStepDone, setGoalsStepDone] = useState(
    () => shortGoals.length + longGoals.length > 0,
  );
  const [insight, setInsight] = useState<InsightData | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  // L'utilisateur applique manuellement le conseil du Renard (sinon il reste juste informatif).
  const [insightApplied, setInsightApplied] = useState(false);
  const [fixedCharges, setFixedCharges] = useState<{ libelle: string; montant: number }[]>([]);
  const [budgetAdvice, setBudgetAdvice] = useState<BudgetAdvice | null>(null);
  const [budgetAdviceLoading, setBudgetAdviceLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Demande au conseiller IA local de repérer les charges fixes mensuelles (loyer, abonnements...)
  // afin qu'elles soient exclues du budget hebdomadaire.
  const fetchFixedCharges = useCallback(async (parsed: Transaction[]) => {
    const { items, months } = fixedChargeCandidates(parsed);
    if (!items.length) {
      setFixedCharges([]);
      return;
    }
    // Réponse immédiate (heuristique) pour que le budget hebdomadaire exclue tout de suite
    // les charges fixes connues, sans attendre la réponse (parfois lente) du LLM.
    setFixedCharges(heuristicFixedCharges(items, months));
    try {
      const res = await fetch("http://localhost:8000/api/fixed-charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, months }),
      });
      if (!res.ok) throw new Error("Réponse invalide");
      const result = await res.json();
      setFixedCharges(result.charges ?? []);
    } catch {
      // déjà appliqué ci-dessus en attente, rien à faire.
    }
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      setLoading(true);
      try {
        const fileArr = Array.from(files);
        const parsedLists = await Promise.all(fileArr.map(parseCsv));
        const parsed = parsedLists.flat();
        if (!parsed.length) {
          setError("Aucune transaction détectée.");
          setLoading(false);
          return;
        }
        // On conserve l'historique : les nouveaux relevés sont fusionnés avec ceux déjà
        // importés (sans doublons), plutôt que de remplacer l'analyse précédente.
        const merged = mergeTransactions(txs ?? [], parsed);
        setTxs(merged);
        setShowDropZone(false);
        await fetchFixedCharges(merged);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur de lecture du fichier.");
      } finally {
        setLoading(false);
      }
    },
    [fetchFixedCharges, txs],
  );

  // Étape 1 de l'onboarding : relevés des mois précédents, utilisés pour déterminer le
  // profil de dépense (dépensier / raisonnable / économe).
  const handlePastFiles = useCallback(async (files: File[]) => {
    setError(null);
    setLoading(true);
    try {
      const parsedLists = await Promise.all(files.map(parseCsv));
      const parsed = parsedLists.flat();
      if (!parsed.length) {
        setError("Aucune transaction détectée.");
        return;
      }
      setPastTxs(mergeTransactions([], parsed));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de lecture du fichier.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Étape 2 de l'onboarding : relevé (fichier unique) du mois actuel, utilisé pour le solde
  // disponible ("Dépenses courantes") et le camembert "Budget du mois". Conservé à part dans
  // `currentTxs`, et aussi fusionné avec les mois précédents pour l'historique (`txs`).
  const handleCurrentFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      setLoading(true);
      try {
        const parsedLists = await Promise.all(files.map(parseCsv));
        const parsed = parsedLists.flat();
        if (!parsed.length) {
          setError("Aucune transaction détectée.");
          return;
        }
        const merged = mergeTransactions(pastTxs ?? [], parsed);
        setCurrentTxs(mergeTransactions([], parsed));
        setTxs(merged);
        setIntroDone(false);
        setGoalsStepDone(shortGoals.length + longGoals.length > 0);
        setInsight(null);
        setInsightApplied(false);
        setBudgetAdvice(null);
        await fetchFixedCharges(merged);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur de lecture du fichier.");
      } finally {
        setLoading(false);
      }
    },
    [pastTxs, shortGoals, longGoals, fetchFixedCharges],
  );

  const fixedChargeLabels = useMemo(
    () => new Set(fixedCharges.map((c) => normalizeLabel(c.libelle))),
    [fixedCharges],
  );
  const fixedChargesMonthlyTotal = useMemo(
    () => fixedCharges.reduce((s, c) => s + c.montant, 0),
    [fixedCharges],
  );
  const monthlySavingsGoal = useMemo(
    () => monthlySavingsTarget(shortGoals) + monthlySavingsTarget(longGoals),
    [shortGoals, longGoals],
  );
  const data = useMemo(
    () =>
      txs ? compute(txs, fixedChargeLabels, fixedChargesMonthlyTotal, monthlySavingsGoal) : null,
    [txs, fixedChargeLabels, fixedChargesMonthlyTotal, monthlySavingsGoal],
  );
  // Calcul dédié au seul relevé du mois actuel (étape 2) : alimente le solde disponible
  // ("Dépenses courantes") et le camembert "Budget du mois", indépendamment de l'historique.
  const currentData = useMemo(
    () =>
      compute(currentTxs ?? txs ?? [], fixedChargeLabels, fixedChargesMonthlyTotal, monthlySavingsGoal),
    [currentTxs, txs, fixedChargeLabels, fixedChargesMonthlyTotal, monthlySavingsGoal],
  );
  const detectedProfile = useMemo<SpenderProfile | null>(
    () => (data ? detectProfile(data.pastIncome, data.pastExpense) : null),
    [data],
  );
  // Onboarding, dans l'ordre : CSV mois précédents -> CSV mois actuel -> au moins 1 objectif
  // d'épargne -> profil détecté / style d'épargne -> tableau de bord.
  const needsGoals = !!txs && !goalsStepDone;
  const showIntro = !!txs && goalsStepDone && !introDone;

  // Interroge le conseiller IA local. Le conseil retourné reste purement informatif :
  // c'est l'utilisateur qui choisit de l'appliquer (voir applyInsight) à son pot d'épargne.
  const fetchInsight = useCallback(
    async (
      balance: number,
      recent: { label: string; amount: number; date: string }[],
      potCible: string,
      profile: SelfDef | null,
    ) => {
      setInsightLoading(true);
      try {
        const res = await fetch("http://localhost:8000/api/insight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            balance,
            transactions: recent,
            pot_cible: potCible,
            self_def: profile,
          }),
        });
        if (!res.ok) throw new Error("Réponse invalide");
        const result: InsightData = await res.json();
        setInsight(result);
      } catch {
        const fallback: InsightData =
          balance < 20
            ? {
                titre: "Stop, on freine un peu",
                message:
                  "Ton solde est très bas en ce moment. Mets en pause les dépenses non essentielles le temps de laisser ton compte respirer avant de penser à épargner.",
                montant: 0,
                potCible,
              }
            : {
                titre: "Petit écart, grande discipline",
                message: `Transfère un petit montant vers ton pot "${potCible}" pour rester sur la trajectoire et garder ton streak.`,
                montant: 15,
                potCible,
              };
        setInsight(fallback);
      } finally {
        setInsightApplied(false);
        setInsightLoading(false);
      }
    },
    [],
  );

  // Applique le conseil affiché : ajoute le montant suggéré à l'objectif épinglé (ou premier) de
  // l'épargne court terme ; en crée un si aucun objectif n'existe encore.
  const applyInsight = useCallback(() => {
    if (!insight || insightApplied || insight.montant <= 0) return;
    if (!shortGoals.length) {
      setShortGoals([
        {
          id: `goal-${Date.now()}`,
          name: insight.potCible,
          target: 0,
          deadline: "",
          saved: insight.montant,
          pinned: true,
        },
      ]);
    } else {
      const target = pinnedOrFirst(shortGoals)!;
      setShortGoals(
        shortGoals.map((g) =>
          g.id === target.id ? { ...g, saved: g.saved + insight.montant } : g,
        ),
      );
    }
    setInsightApplied(true);
  }, [insight, insightApplied, shortGoals, setShortGoals]);

  // À la fin de l'onboarding : envoie le profil + l'agrégat des 6 derniers mois au conseiller IA local.
  const handleProfileContinue = useCallback(
    async (choice: SelfDef) => {
      setSelfDef(choice);
      setIntroDone(true);
      if (!txs) return;
      const d = compute(txs);
      const balance = Math.max(0, Math.round(d.income - d.expense));
      const potCible = pinnedOrFirst(shortGoals)?.name || "Cotisation WEI 2026";
      const recent = d.recent.map((t) => ({
        label: t.label,
        amount: t.amount,
        date: t.date.toISOString().slice(0, 10),
      }));
      await fetchInsight(balance, recent, potCible, choice);
    },
    [txs, shortGoals, setSelfDef, fetchInsight],
  );

  // Panneau de démo : simule une dépense Fast-Food de 15€ et interroge le conseiller IA local.
  const handleDemoExpense = useCallback(async () => {
    if (!txs) return;
    // On date la transaction de démo au dernier jour connu du relevé (le "aujourd'hui" simulé),
    // pas à la date système réelle : sinon elle devient le nouveau jour le plus récent et fausse
    // currentMonthDay (donc le budget de TOUTES les catégories, pas seulement Fast-Food).
    const simulatedToday = txs.reduce((max, t) => (t.date > max ? t.date : max), txs[0].date);
    const newTx: Transaction = {
      id: `tx-demo-${Date.now()}`,
      date: simulatedToday,
      label: "Fast-Food",
      amount: -15,
      category: "Restaurants & Bars",
    };
    const updated = [...txs, newTx];
    setTxs(updated);

    const updatedData = compute(updated);
    const balance = Math.max(0, Math.round(updatedData.income - updatedData.expense));
    const potCible = pinnedOrFirst(shortGoals)?.name || "Cotisation WEI 2026";
    const recent = updatedData.recent.map((t) => ({
      label: t.label,
      amount: t.amount,
      date: t.date.toISOString().slice(0, 10),
    }));
    await fetchInsight(balance, recent, potCible, selfDef);
  }, [txs, shortGoals, selfDef, fetchInsight]);

  // Onglet "Conseil du Renard" : demande au LLM local un budget conseillé pour le mois
  // prochain (par catégorie) et des pistes concrètes de réduction de dépenses, en fonction
  // des objectifs d'épargne en cours.
  const fetchBudgetAdvice = useCallback(async () => {
    if (!data) return;
    setBudgetAdviceLoading(true);
    try {
      const res = await fetch("http://localhost:8000/api/budget-advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthly_disposable: data.monthlyDisposable,
          fixed_charges: fixedChargesMonthlyTotal,
          monthly_savings_goal: monthlySavingsGoal,
          current_spending: currentData.currentMonth,
          baseline: data.baseline,
          goals: [
            ...shortGoals.map((g) => ({ ...g, kind: "short" })),
            ...longGoals.map((g) => ({ ...g, kind: "long" })),
          ],
          self_def: selfDef,
        }),
      });
      if (!res.ok) throw new Error("Réponse invalide");
      setBudgetAdvice(await res.json());
    } catch {
      const baselineTotal = (Object.values(data.baseline) as number[]).reduce(
        (s, v) => s + v,
        0,
      );
      setBudgetAdvice({
        titre: "Budget conseillé pour le mois prochain",
        message:
          "Voici une répartition de ton revenu disponible pour le mois prochain, basée sur tes habitudes de dépenses.",
        budget: (Object.entries(data.baseline) as [BudgetCat, number][]).map(([cat, base]) => ({
          categorie: cat,
          montant:
            baselineTotal > 0 ? Math.round((data.monthlyDisposable * base) / baselineTotal) : 0,
        })),
        conseils: ["Vise à réduire tes postes de dépenses non essentiels pour avancer vers tes objectifs d'épargne."],
      });
    } finally {
      setBudgetAdviceLoading(false);
    }
  }, [data, currentData, fixedChargesMonthlyTotal, monthlySavingsGoal, shortGoals, longGoals, selfDef]);

  useEffect(() => {
    if (tab === "analyse" && !budgetAdvice && !budgetAdviceLoading) {
      void fetchBudgetAdvice();
    }
  }, [tab, budgetAdvice, budgetAdviceLoading, fetchBudgetAdvice]);

  return (
    <div className="min-h-screen relative overflow-hidden pb-32">
      <div className="glow-orb w-[500px] h-[500px] -top-40 -left-40 bg-[var(--ember)]" />
      <div className="glow-orb w-[400px] h-[400px] top-1/3 -right-40 bg-[var(--ember-glow)]" />

      <header className="relative z-10 max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <button
          onClick={() => {
            if (walletOpen) setWalletOpen(null);
            else if (tab !== "epargne") setTab("epargne");
            else navigate({ to: "/" });
          }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" /> Retour
        </button>
        {txs && !needsGoals && !showIntro && (
          <button
            onClick={() => {
              setWalletOpen(null);
              setShowDropZone(true);
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Charger un autre fichier
          </button>
        )}
      </header>

      {!pastTxs ? (
        <CsvStepDropZone
          step={1}
          title="Entre tes relevés bancaires des mois précédents"
          description="Ces relevés permettent au Renard d'établir ton profil de dépense (dépensier, raisonnable ou économe)."
          hint="Tu peux sélectionner plusieurs CSV à la fois (ex. les 6 derniers mois)."
          multiple
          loading={loading}
          error={error}
          onContinue={handlePastFiles}
        />
      ) : !txs ? (
        <CsvStepDropZone
          step={2}
          title="Dépose le relevé du mois actuel"
          description="Ce relevé (un seul fichier) sert au calcul de ton solde disponible et au camembert du budget de ce mois."
          hint="Choisis le CSV correspondant au mois en cours, distinct de tes relevés précédents."
          loading={loading}
          error={error}
          onContinue={handleCurrentFiles}
          onBack={() => setPastTxs(null)}
        />
      ) : showDropZone ? (
        <DropZone
          {...{ dragOver, setDragOver, loading, error, onFiles: handleFiles, inputRef }}
          onCancel={() => setShowDropZone(false)}
        />
      ) : needsGoals ? (
        <GoalsOnboarding
          shortGoals={shortGoals}
          longGoals={longGoals}
          setShortGoals={setShortGoals}
          setLongGoals={setLongGoals}
          onContinue={() => setGoalsStepDone(true)}
        />
      ) : showIntro ? (
        <ProfileIntro
          detected={detectedProfile!}
          selfDef={selfDef}
          onContinue={handleProfileContinue}
        />
      ) : walletOpen ? (
        <WalletPage
          which={walletOpen}
          onBack={() => setWalletOpen(null)}
          currentData={currentData}
          shortGoals={shortGoals}
          longGoals={longGoals}
          setShortGoals={setShortGoals}
          setLongGoals={setLongGoals}
        />
      ) : (
        <main className="relative z-10 max-w-5xl mx-auto px-5 space-y-6">
          {tab === "epargne" && (
            <EpargneTab
              data={data!}
              currentData={currentData}
              onOpen={setWalletOpen}
              shortGoals={shortGoals}
              longGoals={longGoals}
              insight={insight}
              insightLoading={insightLoading}
              insightApplied={insightApplied}
              onApplyInsight={applyInsight}
              streak={data!.streak}
            />
          )}
          {tab === "stats" && <StatsTab data={data!} shortGoals={shortGoals} longGoals={longGoals} />}
          {tab === "analyse" && (
            <AnalyseTab
              data={data!}
              currentData={currentData}
              advice={budgetAdvice}
              loading={budgetAdviceLoading}
              onRefresh={() => {
                setBudgetAdvice(null);
                void fetchBudgetAdvice();
              }}
            />
          )}
          {tab === "formation" && <FormationTab />}
          {tab === "compte" && (
            <CompteTab
              data={data!}
              detected={detectedProfile!}
              selfDef={selfDef}
              setSelfDef={setSelfDef}
              fixedCharges={fixedCharges}
            />
          )}
        </main>
      )}

      {txs && !walletOpen && !needsGoals && !showIntro && !showDropZone && (
        <BottomNav tab={tab} setTab={setTab} />
      )}

      {/* Bouton de test : ajoute une dépense Fast-Food de 15€ et déclenche le conseil IA local */}
      {txs && !walletOpen && !needsGoals && !showIntro && !showDropZone && (
        <button
          onClick={handleDemoExpense}
          title="Tester : ajouter une dépense de 15€"
          className="fixed bottom-24 right-4 z-40 glass rounded-full pl-3 pr-4 py-2 flex items-center gap-2 text-sm font-medium hover:bg-white/10 transition-colors"
        >
          <Flame className="size-4 text-[var(--ember)]" /> Test +15€
        </button>
      )}
    </div>
  );
}

// ---------- Drop Zone ----------
function DropZone({
  dragOver,
  setDragOver,
  loading,
  error,
  onFiles,
  inputRef,
  onCancel,
}: {
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  loading: boolean;
  error: string | null;
  onFiles: (files: FileList | File[]) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onCancel?: () => void;
}) {
  return (
    <main className="relative z-10 max-w-3xl mx-auto px-6 pt-10">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files;
          if (f?.length) onFiles(f);
        }}
        className={`glass-strong rounded-3xl p-12 text-center transition-all ${dragOver ? "scale-[1.02] ring-2 ring-[var(--ember)]" : ""}`}
      >
        <img
          src={foxAdvisor}
          alt=""
          className="size-32 object-contain mx-auto mb-6 animate-float"
        />
        <h1 className="text-3xl font-display font-bold mb-2">Dépose ton relevé</h1>
        <p className="text-muted-foreground mb-6 inline-flex items-center gap-1.5">
          <Lock className="size-3.5" /> Analyse 100% locale, rien n'est envoyé.
        </p>
        <p className="text-xs text-white/50 mb-4">
          Tu peux sélectionner plusieurs CSV à la fois (ex. 6 mois de relevés) pour une analyse plus
          précise.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          multiple
          className="hidden"
          onChange={(e) => {
            const f = e.target.files;
            if (f?.length) onFiles(f);
          }}
        />
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => inputRef.current?.click()}
            className="liquid-tab px-6 py-3 inline-flex items-center gap-2 font-medium"
          >
            <Upload className="size-4" /> Choisir un ou plusieurs CSV
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded-full px-6 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Annuler
            </button>
          )}
        </div>
        {onCancel && (
          <p className="text-xs text-white/50 mt-4">
            Les nouveaux relevés seront ajoutés à l'analyse déjà en cours, sans rien effacer.
          </p>
        )}
        {loading && <p className="mt-6 text-sm text-muted-foreground">Analyse en cours…</p>}
        {error && <p className="mt-6 text-sm text-destructive">{error}</p>}
      </div>
    </main>
  );
}

// ---------- Étapes d'import CSV à l'onboarding (mois précédents puis mois actuel) ----------
function CsvStepDropZone({
  step,
  title,
  description,
  hint,
  multiple = true,
  loading,
  error,
  onContinue,
  onBack,
}: {
  step: 1 | 2;
  title: string;
  description: string;
  hint?: string;
  multiple?: boolean;
  loading: boolean;
  error: string | null;
  onContinue: (files: File[]) => void;
  onBack?: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    setFiles((prev) => (multiple ? [...prev, ...arr] : arr));
  }

  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <main className="relative z-10 max-w-3xl mx-auto px-6 pt-10">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files;
          if (f?.length) addFiles(f);
        }}
        className={`glass-strong rounded-3xl p-12 text-center transition-all ${dragOver ? "scale-[1.02] ring-2 ring-[var(--ember)]" : ""}`}
      >
        <img
          src={foxAdvisor}
          alt=""
          className="size-32 object-contain mx-auto mb-6 animate-float"
        />
        <div className="text-[10px] uppercase tracking-[0.2em] text-white/60 mb-2">
          Étape {step}/2
        </div>
        <h1 className="text-3xl font-display font-bold mb-2">{title}</h1>
        <p className="text-muted-foreground mb-6 inline-flex items-center gap-1.5 justify-center text-center">
          <Lock className="size-3.5 shrink-0" /> {description}
        </p>
        {hint && <p className="text-xs text-white/50 mb-4">{hint}</p>}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files;
            if (f?.length) addFiles(f);
            e.target.value = "";
          }}
        />
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => inputRef.current?.click()}
            className="liquid-tab px-6 py-3 inline-flex items-center gap-2 font-medium"
          >
            <Upload className="size-4" /> {multiple ? "Choisir un ou plusieurs CSV" : "Choisir un CSV"}
          </button>
          {onBack && (
            <button
              onClick={onBack}
              className="rounded-full px-6 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5 justify-center"
            >
              <ArrowLeft className="size-4" /> Précédent
            </button>
          )}
          <button
            onClick={() => onContinue(files)}
            disabled={!files.length || loading}
            className="liquid-tab px-6 py-3 inline-flex items-center gap-2 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Suivant <ArrowRight className="size-4" />
          </button>
        </div>
        {files.length > 0 && (
          <ul className="mt-5 space-y-1.5 text-left max-w-md mx-auto">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between gap-2 glass rounded-xl px-3 py-1.5 text-sm"
              >
                <span className="truncate">{f.name}</span>
                <button
                  onClick={() => removeFile(i)}
                  className="text-white/50 hover:text-white shrink-0"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {loading && <p className="mt-6 text-sm text-muted-foreground">Analyse en cours…</p>}
        {error && <p className="mt-6 text-sm text-destructive">{error}</p>}
      </div>
    </main>
  );
}

// ---------- Onboarding : au moins 1 objectif d'épargne avant d'entrer dans le tableau de bord ----------
const EMPTY_ONBOARD_GOAL = { name: "", target: 0, deadline: "", saved: 0 };

function GoalsOnboarding({
  shortGoals,
  longGoals,
  setShortGoals,
  setLongGoals,
  onContinue,
}: {
  shortGoals: SavingsGoal[];
  longGoals: SavingsGoal[];
  setShortGoals: (v: SavingsGoal[]) => void;
  setLongGoals: (v: SavingsGoal[]) => void;
  onContinue: () => void;
}) {
  const [kind, setKind] = useState<"short" | "long">("short");
  const [form, setForm] = useState(EMPTY_ONBOARD_GOAL);
  const total = shortGoals.length + longGoals.length;

  function addGoal() {
    if (!form.name.trim()) return;
    const goals = kind === "short" ? shortGoals : longGoals;
    const set = kind === "short" ? setShortGoals : setLongGoals;
    set([...goals, { id: `goal-${Date.now()}`, ...form, pinned: goals.length === 0 }]);
    setForm(EMPTY_ONBOARD_GOAL);
  }

  function removeGoal(k: "short" | "long", id: string) {
    if (k === "short") setShortGoals(shortGoals.filter((g) => g.id !== id));
    else setLongGoals(longGoals.filter((g) => g.id !== id));
  }

  return (
    <main className="relative z-10 max-w-2xl mx-auto px-5 pt-6 space-y-6">
      <section className="glass-strong rounded-3xl p-8 text-center">
        <img
          src={foxAdvisor}
          alt=""
          className="size-20 object-contain mx-auto mb-4 animate-float"
        />
        <div className="text-[10px] uppercase tracking-[0.2em] text-white/60">Dernière étape</div>
        <h1 className="font-display text-xl sm:text-2xl font-semibold mt-2 text-white">
          Définis ton premier objectif d'épargne
        </h1>
        <p className="text-sm text-white/70 mt-3 max-w-md mx-auto">
          Ajoute au moins un objectif, à courte ou longue durée, pour que le Renard puisse
          t'accompagner vers ton budget idéal.
        </p>
      </section>

      <section className="glass-strong rounded-3xl p-6 space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            { id: "short" as const, label: "Épargne à courte durée", color: "#e94560" },
            { id: "long" as const, label: "Épargne à longue durée", color: "#a83bb3" },
          ].map((opt) => {
            const active = kind === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setKind(opt.id)}
                className={`text-left rounded-2xl p-4 transition-all border ${active ? "border-white/40 scale-[1.01]" : "border-white/10 hover:border-white/25"}`}
                style={{
                  background: active
                    ? `linear-gradient(135deg, color-mix(in oklab, ${opt.color} 25%, transparent), rgba(255,255,255,0.04))`
                    : "rgba(255,255,255,0.03)",
                }}
              >
                <div className="font-display font-bold" style={{ color: opt.color }}>
                  {opt.label}
                </div>
              </button>
            );
          })}
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-white/70">Nom de l'objectif</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex: Vacances, Apport appart..."
              className="mt-1 w-full glass rounded-xl px-3 py-2 outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs text-white/70">Montant cible (€)</span>
            <input
              type="number"
              value={form.target}
              onChange={(e) =>
                setForm({ ...form, target: e.target.value === "" ? 0 : +e.target.value })
              }
              className="mt-1 w-full glass rounded-xl px-3 py-2 outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs text-white/70">Échéance</span>
            <input
              type="date"
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
              className="mt-1 w-full glass rounded-xl px-3 py-2 outline-none"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-white/70">Déjà épargné (€)</span>
          <input
            type="number"
            value={form.saved}
            onChange={(e) =>
              setForm({ ...form, saved: e.target.value === "" ? 0 : +e.target.value })
            }
            className="mt-1 w-full glass rounded-xl px-3 py-2 outline-none"
          />
        </label>

        <button
          onClick={addGoal}
          className="liquid-tab px-5 py-2.5 font-medium inline-flex items-center gap-2"
        >
          <Target className="size-4" /> Ajouter l'objectif
        </button>
      </section>

      {total > 0 && (
        <section className="glass-strong rounded-3xl p-6 space-y-2">
          <h2 className="text-sm font-semibold text-white/80">Tes objectifs</h2>
          {[
            ...shortGoals.map((g) => ({ ...g, kind: "short" as const })),
            ...longGoals.map((g) => ({ ...g, kind: "long" as const })),
          ].map((g) => (
            <div
              key={g.id}
              className="glass rounded-2xl px-4 py-2.5 flex items-center justify-between gap-2 text-sm"
            >
              <span>
                {g.name || "Objectif sans nom"}{" "}
                <span className="text-white/50">
                  ({g.kind === "short" ? "court terme" : "long terme"})
                </span>
              </span>
              <button
                onClick={() => removeGoal(g.kind, g.id)}
                className="text-destructive/80 hover:text-destructive text-xs"
              >
                Supprimer
              </button>
            </div>
          ))}
        </section>
      )}

      <button
        disabled={total === 0}
        onClick={onContinue}
        className="liquid-tab w-full px-6 py-3 font-medium inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Continuer vers mon tableau de bord <ArrowRight className="size-4" />
      </button>
    </main>
  );
}

// ---------- Wallet Card (the “portefeuille”) ----------
function WalletCard({
  label,
  title,
  subtitle,
  amount,
  accent,
  onClick,
}: {
  label: string;
  title: string;
  subtitle: string;
  amount: number;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative w-full text-left rounded-[28px] p-5 overflow-hidden glass-strong transition-all hover:-translate-y-0.5 hover:shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)]"
      style={{
        background: `linear-gradient(135deg, color-mix(in oklab, ${accent} 22%, transparent), rgba(255,255,255,0.04))`,
      }}
    >
      {/* leather stitch */}
      <div className="absolute inset-2 rounded-[22px] border border-dashed border-white/15 pointer-events-none" />
      <div
        className="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-2xl opacity-40"
        style={{ background: accent }}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/70">
            <Wallet className="size-3.5" /> {label}
          </div>
          <div className="mt-2 font-display font-bold text-lg leading-tight">{title}</div>
          <div className="text-xs text-white/60 mt-0.5">{subtitle}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="text-[10px] uppercase tracking-wider text-white/50 glass rounded-full px-2 py-0.5">
            Ce mois
          </span>
          <ArrowRight className="size-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition" />
        </div>
      </div>
      <div className="relative mt-6 font-display text-3xl font-bold" style={{ color: accent }}>
        {fmt(amount)}
      </div>
    </button>
  );
}

// ---------- Épargne tab (3 portefeuilles + Budget + objectifs + opérations) ----------
function EpargneTab({
  data,
  currentData,
  onOpen,
  shortGoals,
  longGoals,
  insight,
  insightLoading,
  insightApplied,
  onApplyInsight,
  streak,
}: {
  data: Computed;
  currentData: Computed;
  onOpen: (w: "courant" | "court" | "long") => void;
  shortGoals: SavingsGoal[];
  longGoals: SavingsGoal[];
  insight: InsightData | null;
  insightLoading: boolean;
  insightApplied: boolean;
  onApplyInsight: () => void;
  streak: number;
}) {
  // Solde "Dépenses courantes" calculé uniquement à partir du relevé du mois actuel.
  const courant = Math.round(currentData.income - currentData.expense);
  const shortSaved = shortGoals.reduce((s, g) => s + g.saved, 0);
  const longSaved = longGoals.reduce((s, g) => s + g.saved, 0);
  const shortPinned = pinnedOrFirst(shortGoals);
  const longPinned = pinnedOrFirst(longGoals);

  return (
    <>
      <div className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium">
        <Flame className="size-3.5 text-[var(--ember)]" /> Streak :{" "}
        <span className="font-bold">{streak} mois</span>
      </div>

      <section className="grid sm:grid-cols-3 gap-4">
        <WalletCard
          label="Dépenses courantes"
          title="Solde disponible"
          subtitle="Ton compte du quotidien"
          amount={courant}
          accent={courant < 0 ? "#e94560" : "#52b04a"}
          onClick={() => onOpen("courant")}
        />
        <WalletCard
          label="Épargne à courte durée"
          title={shortPinned?.name || "Définis ton objectif"}
          subtitle={`${shortGoals.length} objectif${shortGoals.length === 1 ? "" : "s"}`}
          amount={shortSaved}
          accent="#e94560"
          onClick={() => onOpen("court")}
        />
        <WalletCard
          label="Épargne à longue durée"
          title={longPinned?.name || "Définis ton objectif"}
          subtitle={`${longGoals.length} objectif${longGoals.length === 1 ? "" : "s"}`}
          amount={longSaved}
          accent="#a83bb3"
          onClick={() => onOpen("long")}
        />
      </section>

      <InsightCard
        insight={insight}
        loading={insightLoading}
        applied={insightApplied}
        onApply={onApplyInsight}
      />

      <BudgetPie data={currentData} shortGoals={shortGoals} longGoals={longGoals} />

      <ObjectifsSection shortGoals={shortGoals} longGoals={longGoals} />

      <section className="glass-strong rounded-3xl p-6">
        <h2 className="font-display text-2xl font-bold mb-4">Dernières opérations</h2>
        <ul className="divide-y divide-white/5">
          {data.recent.map((t) => {
            const bc = mapToBudgetCat(t);
            const color = bc ? CAT_COLORS[bc] : "#888";
            return (
              <li key={t.id} className="py-3 flex items-center gap-3">
                <span className="size-3 rounded-full shrink-0" style={{ background: color }} />
                <span className="flex-1 truncate">{t.label}</span>
                <span
                  className={`font-mono font-semibold ${t.amount < 0 ? "text-destructive" : "text-[var(--ember-glow)]"}`}
                >
                  {t.amount < 0 ? "−" : "+"}
                  {Math.abs(t.amount).toFixed(2)} €
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

// ---------- Insight card : conseil du Renard, alimenté par /api/insight ----------
// Le conseil est purement informatif : c'est l'utilisateur qui choisit de l'appliquer
// (bouton "Appliquer") à son épargne court terme, pour que les chiffres affichés ne
// changent jamais tout seuls d'un chargement à l'autre.
function InsightCard({
  insight,
  loading,
  applied,
  onApply,
}: {
  insight: InsightData | null;
  loading: boolean;
  applied: boolean;
  onApply: () => void;
}) {
  return (
    <section className="glass-strong rounded-3xl p-6">
      <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--ember-glow)]">
        <Sparkles className="size-3.5" /> Conseil du Renard
      </div>
      {loading ? (
        <div className="mt-3 space-y-2 animate-pulse">
          <div className="h-5 w-2/3 rounded-full bg-white/10" />
          <div className="h-4 w-full rounded-full bg-white/10" />
          <div className="h-4 w-5/6 rounded-full bg-white/10" />
        </div>
      ) : insight ? (
        <>
          <h3 className="mt-2 font-display text-xl font-bold">{insight.titre}</h3>
          <p className="mt-1.5 text-sm text-white/75 leading-relaxed">{insight.message}</p>
          {insight.montant > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--ember)]/15 px-3 py-1.5 text-xs font-semibold text-[var(--ember-glow)]">
                <ArrowRight className="size-3.5" /> +{insight.montant} € vers {insight.potCible}
              </span>
              <button
                onClick={onApply}
                disabled={applied}
                className="rounded-full px-3 py-1.5 text-xs font-semibold liquid-tab disabled:opacity-50"
              >
                {applied ? "✓ Appliqué" : "Appliquer"}
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-white/60">
          Le Renard analyse tes finances en local et te propose un conseil dès qu'une dépense tombe.
        </p>
      )}
    </section>
  );
}

// ---------- Budget Pie : zones prédéfinies + part claire qui se réduit + zone épargne ----------
function BudgetPie({
  data,
  shortGoals,
  longGoals,
}: {
  data: Computed;
  shortGoals: SavingsGoal[];
  longGoals: SavingsGoal[];
}) {
  // Le camembert affiche la répartition de toutes les dépenses du mois en cours
  // (hors charges fixes mensuelles, déjà exclues de data.currentMonth), entièrement
  // "consommées" puisque ce sont des dépenses déjà réalisées.
  const consumed: Record<BudgetCat, number> = data.currentMonth;

  const shortTarget = monthlySavingsTarget(shortGoals);
  const longTarget = monthlySavingsTarget(longGoals);
  const split = splitSavingsFilled(data.currentMonthSaved, shortTarget, longTarget);

  const slices = buildSlices(
    data.currentMonth,
    consumed,
    { target: shortTarget, filled: split.short },
    { target: longTarget, filled: split.long },
  );
  const totalBudget = slices.reduce((s, x) => s + x.total, 0);
  const totalConsumed = slices.reduce((s, x) => s + Math.min(x.total, x.filled), 0);

  return (
    <section className="glass-strong rounded-3xl p-6">
      <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-display text-2xl font-bold">Budget du mois</h2>
        <p className="text-xs text-white/60">
          Toutes les dépenses du mois, hors charges fixes (jour {data.currentMonthDay}/
          {data.currentMonthDays})
        </p>
      </div>
      <div className="grid sm:grid-cols-[auto_1fr] gap-6 items-center justify-items-center sm:justify-items-start">
        <Donut
          slices={slices}
          center={
            <>
              <div className="text-[10px] uppercase tracking-widest text-white/50">Consommé</div>
              <div className="font-display font-bold text-xl">
                {totalBudget > 0 ? Math.round((totalConsumed / totalBudget) * 100) : 0}%
              </div>
              <div className="text-[10px] text-white/40 mt-0.5">
                {Math.round(totalConsumed)}/{Math.round(totalBudget)}€
              </div>
            </>
          }
        />
        <ul className="space-y-2 text-sm w-full sm:min-w-[220px]">
          {slices.map((s) => {
            const pct = s.total > 0 ? Math.round((s.filled / s.total) * 100) : 0;
            return (
              <li key={s.label}>
                <div className="flex items-center gap-3">
                  <span className="size-3.5 rounded-sm" style={{ background: s.color }} />
                  <span className="flex-1">{s.label}</span>
                  <span className="font-mono text-xs text-white/70">
                    {Math.round(s.filled)}/{Math.round(s.total)}€
                  </span>
                </div>
                <div className="ml-6 mt-1 h-1 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, pct)}%`, background: s.color }}
                  />
                </div>
              </li>
            );
          })}
          {shortTarget < 0.5 && longTarget < 0.5 && (
            <li className="text-xs text-white/55 ml-6 mt-2">
              💡 Définis un objectif d'épargne pour réserver une zone dédiée dans ton budget.
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

// ---------- Objectifs (basé sur les goals saisis) ----------
function ObjectifsSection({
  shortGoals,
  longGoals,
}: {
  shortGoals: SavingsGoal[];
  longGoals: SavingsGoal[];
}) {
  const sortByPinned = (goals: SavingsGoal[]) =>
    [...goals].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const items = [
    ...sortByPinned(shortGoals).map((g) => ({ ...g, color: "#e94560" })),
    ...sortByPinned(longGoals).map((g) => ({ ...g, color: "#a83bb3" })),
  ];
  if (items.length === 0) {
    return (
      <section className="glass-strong rounded-3xl p-6">
        <h2 className="font-display text-2xl font-bold mb-2">Objectifs</h2>
        <p className="text-sm text-white/60">
          Aucun objectif d'épargne pour le moment. Ajoute-en un depuis tes portefeuilles d'épargne.
        </p>
      </section>
    );
  }
  return (
    <section className="glass-strong rounded-3xl p-6">
      <h2 className="font-display text-2xl font-bold mb-4">Objectifs</h2>
      <div className="space-y-5">
        {items.map((it) => {
          const pct = it.target > 0 ? Math.min(100, Math.round((it.saved / it.target) * 100)) : 0;
          const status =
            it.target === 0
              ? "À DÉFINIR"
              : pct >= 100
                ? "ATTEINT"
                : pct >= 50
                  ? "EN BONNE VOIE"
                  : "À POUSSER";
          return (
            <div key={it.id}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium uppercase text-sm tracking-wide inline-flex items-center gap-1.5">
                  {it.pinned && <Target className="size-3.5" style={{ color: it.color }} />}
                  {it.name || "Objectif sans nom"}
                </span>
                <span className="text-[10px] font-bold tracking-wider" style={{ color: it.color }}>
                  {status}
                </span>
              </div>
              <div className="h-7 rounded-full glass relative overflow-hidden">
                <div
                  className="h-full rounded-full flex items-center justify-center text-xs font-bold transition-all"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${it.color}, ${it.color}cc)`,
                  }}
                >
                  {pct > 8 ? `${pct}%` : ""}
                </div>
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-white/55">
                <span>
                  {Math.round(it.saved)}€ / {Math.round(it.target)}€
                </span>
                {it.deadline && <span>échéance {it.deadline}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------- Wallet detail page ----------
function WalletPage({
  which,
  onBack,
  currentData,
  shortGoals,
  longGoals,
  setShortGoals,
  setLongGoals,
}: {
  which: "courant" | "court" | "long";
  onBack: () => void;
  currentData: Computed;
  shortGoals: SavingsGoal[];
  longGoals: SavingsGoal[];
  setShortGoals: (v: SavingsGoal[]) => void;
  setLongGoals: (v: SavingsGoal[]) => void;
}) {
  return (
    <main className="relative z-10 max-w-3xl mx-auto px-5">
      <button
        onClick={onBack}
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-2 mb-4"
      >
        <ArrowLeft className="size-4" /> Retour aux portefeuilles
      </button>
      {which === "courant" && <CurrentWalletDetail data={currentData} />}
      {which === "court" && (
        <SavingsGoalPage which="short" goals={shortGoals} setGoals={setShortGoals} />
      )}
      {which === "long" && (
        <SavingsGoalPage which="long" goals={longGoals} setGoals={setLongGoals} />
      )}
    </main>
  );
}

function CurrentWalletDetail({ data }: { data: Computed }) {
  const courant = Math.round(data.income - data.expense);
  return (
    <div
      className="glass-strong rounded-[28px] p-6 sm:p-8 space-y-5"
      style={{
        background: `linear-gradient(135deg, color-mix(in oklab, ${courant < 0 ? "#e94560" : "#52b04a"} 25%, transparent), rgba(255,255,255,0.04))`,
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.2em] text-white/60 inline-flex items-center gap-2">
        <Wallet className="size-3.5" /> Dépenses courantes
      </div>
      <h1 className="font-display text-3xl font-bold">Dépenses courantes</h1>
      <div
        className="font-display text-5xl font-bold"
        style={{ color: courant < 0 ? "#e94560" : "#52b04a" }}
      >
        {fmt(courant)}
      </div>
      {data.months.length > 1 && (
        <p className="text-xs text-white/55">
          Ces chiffres représentent {data.months.length} mois de relevés importés.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="glass rounded-2xl p-4">
          <div className="text-white/60 text-xs">Revenus</div>
          <div className="font-mono font-bold text-lg text-[var(--ember-glow)]">
            +{Math.round(data.income)}€
          </div>
        </div>
        <div className="glass rounded-2xl p-4">
          <div className="text-white/60 text-xs">Dépenses</div>
          <div className="font-mono font-bold text-lg text-destructive">
            −{Math.round(data.expense)}€
          </div>
        </div>
      </div>
      <p className="text-sm text-white/70">
        Ce portefeuille reflète ce qu'il te reste après tes dépenses (hors loyer et charges fixes,
        déjà déduites de ton budget mensuel). Il peut devenir négatif si tes dépenses dépassent tes
        revenus. Il sert de base à tes virements automatiques vers tes deux portefeuilles d'épargne.
      </p>
    </div>
  );
}

const EMPTY_GOAL_FORM = { name: "", target: 0, deadline: "", saved: 0 };

function SavingsGoalPage({
  which,
  goals,
  setGoals,
}: {
  which: "short" | "long";
  goals: SavingsGoal[];
  setGoals: (v: SavingsGoal[]) => void;
}) {
  const accent = which === "short" ? "#e94560" : "#a83bb3";
  const label = which === "short" ? "Épargne à courte durée" : "Épargne à longue durée";
  const title = label;
  const [form, setForm] = useState(EMPTY_GOAL_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(t);
  }, [justSaved]);

  const sorted = [...goals].sort((a, b) => Number(b.pinned) - Number(a.pinned));

  function resetForm() {
    setForm(EMPTY_GOAL_FORM);
    setEditingId(null);
  }

  function submit() {
    if (!form.name.trim()) return;
    if (editingId) {
      setGoals(goals.map((g) => (g.id === editingId ? { ...g, ...form } : g)));
    } else {
      setGoals([...goals, { id: `goal-${Date.now()}`, ...form, pinned: goals.length === 0 }]);
    }
    setJustSaved(true);
    resetForm();
  }

  function startEdit(g: SavingsGoal) {
    setEditingId(g.id);
    setForm({ name: g.name, target: g.target, deadline: g.deadline, saved: g.saved });
  }

  function remove(id: string) {
    setGoals(goals.filter((g) => g.id !== id));
    if (editingId === id) resetForm();
  }

  function togglePin(id: string) {
    setGoals(goals.map((g) => (g.id === id ? { ...g, pinned: !g.pinned } : g)));
  }

  return (
    <div
      className="glass-strong rounded-[28px] p-6 sm:p-8 space-y-6"
      style={{
        background: `linear-gradient(135deg, color-mix(in oklab, ${accent} 25%, transparent), rgba(255,255,255,0.04))`,
      }}
    >
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-white/60 inline-flex items-center gap-2">
          <Wallet className="size-3.5" /> {label}
        </div>
        <h1 className="font-display text-3xl font-bold">{title}</h1>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-white/80">
          {editingId ? "Modifier l'objectif" : "Ajouter un nouvel objectif"}
        </h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-white/70">Nom de l'objectif</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={which === "short" ? "Ex: Vacances Lisbonne" : "Ex: Apport appart"}
              className="mt-1 w-full glass rounded-xl px-3 py-2 outline-none focus:ring-2"
              style={{ accentColor: accent }}
            />
          </label>
          <label className="block">
            <span className="text-xs text-white/70">Montant cible (€)</span>
            <input
              type="number"
              value={form.target}
              onChange={(e) =>
                setForm({ ...form, target: e.target.value === "" ? 0 : +e.target.value })
              }
              className="mt-1 w-full glass rounded-xl px-3 py-2 outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs text-white/70">Échéance</span>
            <input
              type="date"
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
              className="mt-1 w-full glass rounded-xl px-3 py-2 outline-none"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs text-white/70">Déjà épargné (€)</span>
          <input
            type="number"
            value={form.saved}
            onChange={(e) =>
              setForm({ ...form, saved: e.target.value === "" ? 0 : +e.target.value })
            }
            className="mt-1 w-full glass rounded-xl px-3 py-2 outline-none"
          />
        </label>

        <div className="flex gap-3 items-center">
          <button
            onClick={submit}
            className="liquid-tab px-5 py-2.5 font-medium inline-flex items-center gap-2"
            style={{
              background: `linear-gradient(180deg, color-mix(in oklab, ${accent} 35%, transparent), color-mix(in oklab, ${accent} 10%, transparent))`,
            }}
          >
            <Target className="size-4" />
            {editingId ? "Enregistrer les modifications" : "Ajouter l'objectif"}
          </button>
          {editingId && (
            <button
              onClick={resetForm}
              className="text-xs text-white/60 hover:text-white self-center"
            >
              Annuler
            </button>
          )}
          {justSaved && (
            <span className="text-xs font-medium" style={{ color: accent }}>
              Objectif enregistré ✓
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-white/80">Tes objectifs</h2>
        {sorted.length === 0 && (
          <p className="text-sm text-white/60">Aucun objectif pour l'instant.</p>
        )}
        {sorted.map((g) => {
          const pct = g.target > 0 ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0;
          return (
            <div key={g.id} className="glass rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium inline-flex items-center gap-1.5">
                  {g.pinned && <Target className="size-3.5" style={{ color: accent }} />}
                  {g.name || "Objectif sans nom"}
                </span>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={() => togglePin(g.id)}
                    className="text-white/60 hover:text-white"
                    title={g.pinned ? "Désépingler" : "Épingler en haut"}
                  >
                    {g.pinned ? "Désépingler" : "Épingler"}
                  </button>
                  <button onClick={() => startEdit(g)} className="text-white/60 hover:text-white">
                    Modifier
                  </button>
                  <button
                    onClick={() => remove(g.id)}
                    className="text-destructive/80 hover:text-destructive"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
              <div className="h-7 rounded-full glass relative overflow-hidden">
                <div
                  className="h-full flex items-center justify-center text-xs font-bold transition-all"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${accent}, ${accent}aa)`,
                  }}
                >
                  {pct > 8 ? `${pct}%` : ""}
                </div>
              </div>
              <div className="flex justify-between text-[11px] text-white/55">
                <span>
                  {Math.round(g.saved)}€ / {Math.round(g.target)}€
                </span>
                {g.deadline && <span>échéance {g.deadline}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Analyse tab : "Conseil du Renard", budget du mois prochain via /api/budget-advice ----------
function AnalyseTab({
  data,
  currentData,
  advice,
  loading,
  onRefresh,
}: {
  data: Computed;
  currentData: Computed;
  advice: BudgetAdvice | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <>
      <section className="glass-strong rounded-3xl p-6">
        <div className="flex items-start gap-4">
          <img src={foxAdvisor} alt="" className="size-16 object-contain shrink-0 animate-float" />
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[var(--ember-glow)] inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5" /> Conseil du Renard
            </div>
            <h2 className="font-display text-xl font-bold mt-1">
              {advice ? advice.titre : "Ton budget pour le mois prochain"}
            </h2>
          </div>
        </div>
        <p className="text-sm text-white/75 mt-3 leading-relaxed">
          {loading
            ? "Le Renard prépare ton budget pour le mois prochain…"
            : advice
              ? advice.message
              : "Demande au Renard de te proposer un budget pour le mois prochain et des pistes pour réduire tes dépenses, en fonction de tes objectifs d'épargne."}
        </p>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="liquid-tab mt-4 px-5 py-2.5 font-medium inline-flex items-center gap-2 disabled:opacity-50"
        >
          <Sparkles className="size-4" /> {advice ? "Régénérer le conseil" : "Obtenir mon budget conseillé"}
        </button>
      </section>

      {advice && advice.budget.length > 0 && (
        <section className="glass-strong rounded-3xl p-6">
          <h3 className="font-display text-lg font-bold mb-3">Budget conseillé pour le mois prochain</h3>
          <ul className="space-y-2">
            {advice.budget.map((b) => {
              const current = currentData.currentMonth[b.categorie as BudgetCat] ?? 0;
              const color = CAT_COLORS[b.categorie as BudgetCat] ?? "#8a8a8a";
              return (
                <li
                  key={b.categorie}
                  className="flex items-center justify-between text-sm glass rounded-2xl px-4 py-3"
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: color }} />
                    {b.categorie}
                  </span>
                  <span className="font-mono text-right">
                    <span className="text-white/50 mr-2">ce mois : {fmt(current)}</span>
                    <span className="font-bold text-[var(--ember-glow)]">{fmt(b.montant)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {advice && advice.conseils.length > 0 && (
        <section className="glass-strong rounded-3xl p-6">
          <h3 className="font-display text-lg font-bold mb-3">Pistes pour réduire tes dépenses</h3>
          <ul className="space-y-2">
            {advice.conseils.map((c, i) => (
              <li key={i} className="text-sm text-white/80 flex items-start gap-2">
                <ArrowRight className="size-3.5 mt-0.5 shrink-0 text-[var(--ember-glow)]" />
                {c}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ---------- Stats tab : lignes liquid glass par mois ----------
function StatsTab({
  data,
  shortGoals,
  longGoals,
}: {
  data: Computed;
  shortGoals: SavingsGoal[];
  longGoals: SavingsGoal[];
}) {
  const months = [...data.months].reverse(); // plus récent en haut
  const maxSaved = Math.max(1, ...months.map((m) => m.saved));
  const totalSaved = months.reduce((s, m) => s + m.saved, 0);
  const last10 = data.months.slice(-10); // chronologique pour la courbe

  return (
    <>
      <section className="glass-strong rounded-3xl p-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="font-display text-2xl font-bold">Statistiques d'épargne</h2>
          <div className="text-sm text-white/70">
            Total épargné :{" "}
            <span className="font-mono font-bold text-[var(--ember-glow)]">
              {Math.round(totalSaved)}€
            </span>
          </div>
        </div>
        <p className="text-xs text-white/55 mt-1">Évolution sur les 10 derniers mois.</p>
        <div className="mt-5">
          <SavingsCurve months={last10} />
        </div>
      </section>

      <section className="space-y-3">
        {months.length === 0 && (
          <div className="glass-strong rounded-3xl p-8 text-center text-white/60">
            Aucun mois détecté dans ton fichier.
          </div>
        )}
        {months.map((m) => (
          <MonthStatRow
            key={m.key}
            m={m}
            maxSaved={maxSaved}
            data={data}
            shortGoals={shortGoals}
            longGoals={longGoals}
          />
        ))}
      </section>
    </>
  );
}

function SavingsCurve({ months }: { months: MonthRow[] }) {
  if (months.length === 0) {
    return <div className="text-sm text-white/50 text-center py-6">Pas encore de données.</div>;
  }
  const W = 600,
    H = 200,
    P = 32;
  const maxV = Math.max(1, ...months.map((m) => m.saved));
  const n = months.length;
  const x = (i: number) => P + (n === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (n - 1));
  const y = (v: number) => H - P - (v / maxV) * (H - 2 * P);

  const pts = months.map((m, i) => [x(i), y(m.saved)] as const);
  const path = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const area = `${path} L ${x(n - 1).toFixed(1)} ${H - P} L ${x(0).toFixed(1)} ${H - P} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <defs>
        <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ember)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--ember)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((f) => (
        <line
          key={f}
          x1={P}
          x2={W - P}
          y1={H - P - f * (H - 2 * P)}
          y2={H - P - f * (H - 2 * P)}
          stroke="rgba(255,255,255,0.08)"
          strokeDasharray="3 4"
        />
      ))}
      <path d={area} fill="url(#curveFill)" />
      <path
        d={path}
        fill="none"
        stroke="var(--ember-glow)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {pts.map(([px, py], i) => (
        <g key={i}>
          <circle
            cx={px}
            cy={py}
            r="4.5"
            fill="var(--ember-glow)"
            stroke="rgba(0,0,0,0.4)"
            strokeWidth="1"
          />
          <text
            x={px}
            y={py - 10}
            textAnchor="middle"
            fontSize="10"
            fill="rgba(255,255,255,0.85)"
            fontFamily="monospace"
          >
            {Math.round(months[i].saved)}€
          </text>
          <text x={px} y={H - 10} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.5)">
            {months[i].label.slice(0, 3)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function MonthStatRow({
  m,
  maxSaved,
  data,
  shortGoals,
  longGoals,
}: {
  m: MonthRow;
  maxSaved: number;
  data: Computed;
  shortGoals: SavingsGoal[];
  longGoals: SavingsGoal[];
}) {
  const [open, setOpen] = useState(false);
  const pct = Math.max(0, (m.saved / maxSaved) * 100);

  // Pour le camembert : zones prédéfinies = baseline globale (référence), consommé = cats du mois
  // + zones épargne court/long avec leur cible mensuelle et "filled" = épargné ce mois-là
  const reference: Record<BudgetCat, number> = emptyCats();
  (Object.keys(data.baseline) as BudgetCat[]).forEach((c) => {
    reference[c] = Math.max(data.baseline[c], m.cats[c]);
  });
  const shortTarget = monthlySavingsTarget(shortGoals);
  const longTarget = monthlySavingsTarget(longGoals);
  const split = splitSavingsFilled(m.saved, shortTarget, longTarget);
  const slices = buildSlices(
    reference,
    m.cats,
    { target: shortTarget, filled: split.short },
    { target: longTarget, filled: split.long },
  );
  const totalRef = slices.reduce((s, x) => s + x.total, 0);
  const totalSpent = slices
    .filter((s) => s.label !== "Épargne courte" && s.label !== "Épargne longue")
    .reduce((s, x) => s + x.filled, 0);

  return (
    <div className="glass-strong rounded-2xl overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full p-4 relative text-left">
        <div
          className="absolute inset-y-0 left-0 opacity-20 pointer-events-none"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--ember), transparent)",
          }}
        />
        <div className="relative flex items-center gap-4">
          <Calendar className="size-5 text-white/60 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-display font-semibold">{m.label}</div>

            <div className="text-xs text-white/55">
              revenus {Math.round(m.income)}€ · dépenses {Math.round(m.spent)}€
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-white/50">Épargné</div>
            <div className="font-display font-bold text-xl text-[var(--ember-glow)]">
              {Math.round(m.saved)}€
            </div>
          </div>
          <ArrowRight
            className={`size-4 text-white/40 transition-transform ${open ? "rotate-90" : ""}`}
          />
        </div>
      </button>
      {open && (
        <div className="border-t border-white/10 p-5 grid sm:grid-cols-[auto_1fr] gap-6 items-center justify-items-center sm:justify-items-start">
          <Donut
            slices={slices}
            size={220}
            thickness={38}
            center={
              <>
                <div className="text-[10px] uppercase tracking-widest text-white/50">Dépensé</div>
                <div className="font-display font-bold text-lg">{Math.round(totalSpent)}€</div>
                <div className="text-[10px] text-white/40 mt-0.5">
                  sur {Math.round(totalRef)}€ prévu
                </div>
              </>
            }
          />
          <ul className="space-y-2 text-sm w-full">
            {slices.map((s) => (
              <li key={s.label} className="flex items-center gap-3">
                <span className="size-3.5 rounded-sm" style={{ background: s.color }} />
                <span className="flex-1">{s.label}</span>
                <span className="font-mono text-xs text-white/70">
                  {s.label === "Épargne courte" || s.label === "Épargne longue"
                    ? `${Math.round(s.filled)}/${Math.round(s.total)}€`
                    : `${Math.round(s.filled)}€`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------- Formation tab : articles ----------
const ARTICLES = [
  {
    title: "Pourquoi épargner avant 25 ans ?",
    tag: "Bases",
    read: "4 min",
    excerpt:
      "Le temps est ton meilleur allié. Comprends comment 50€/mois deviennent 30 000€ grâce aux intérêts composés.",
    body: [
      "Quand tu es jeune, le revenu est limité, mais une variable joue à fond pour toi : le temps. Sur 30 ans, à 6% annuels, 50€/mois deviennent environ 50 000€. Sur 10 ans, 12 000€ seulement.",
      "Avant tout placement, vise un matelas de sécurité de 1 à 3 mois de dépenses sur un livret (LDDS, Livret A). Puis seulement, oriente le reste vers du long terme.",
      "Règle d'or : automatise. Vire vers ton compte d'épargne le jour même où tu reçois ton salaire/bourse. Ce que tu ne vois pas, tu ne le dépenses pas.",
    ],
    quiz: [
      {
        question: "Sur 30 ans à 6% annuels, 50€/mois épargnés deviennent environ :",
        options: ["12 000€", "30 000€", "50 000€", "100 000€"],
        correct: 2,
      },
      {
        question: "Avant tout placement, que recommande l'article ?",
        options: [
          "Un matelas de sécurité de 1 à 3 mois de dépenses sur un livret",
          "Investir directement en bourse",
          "Emprunter pour investir plus vite",
          "Attendre d'avoir 10 000€ avant d'épargner",
        ],
        correct: 0,
      },
      {
        question: "Quelle est la \"règle d'or\" pour bien épargner ?",
        options: [
          "Épargner ce qu'il reste en fin de mois",
          "Automatiser le virement dès la réception du salaire",
          "Épargner une fois par an",
          "Demander à ses parents de gérer l'épargne",
        ],
        correct: 1,
      },
    ],
  },
  {
    title: "Livret A, LDDS, PEL : où mettre tes premiers euros ?",
    tag: "Épargne sûre",
    read: "5 min",
    excerpt:
      "Les enveloppes garanties par l'État. Liquides, sans risque, mais à rendement limité — parfaites pour l'épargne court terme.",
    body: [
      "Livret A : plafond 22 950€, taux fixé par l'État, retrait immédiat. C'est ta base.",
      "LDDS : équivalent du Livret A avec un plafond de 12 000€. Cumulable.",
      "PEL : utile uniquement si tu vises l'achat immobilier sous 4-10 ans.",
      "Verdict : Livret A en n°1 pour l'épargne courte. Au-dessus du plafond, vise des supports plus rémunérateurs.",
    ],
    quiz: [
      {
        question: "Quel est le plafond du Livret A ?",
        options: ["12 000€", "22 950€", "50 000€", "Aucun plafond"],
        correct: 1,
      },
      {
        question: "Quel est le plafond du LDDS ?",
        options: ["8 000€", "12 000€", "15 000€", "22 950€"],
        correct: 1,
      },
      {
        question: "Le PEL est surtout utile si tu vises :",
        options: [
          "Un achat immobilier sous 4-10 ans",
          "Un investissement en cryptomonnaies",
          "Une épargne disponible immédiatement",
          "Un placement sans aucune contrainte",
        ],
        correct: 0,
      },
    ],
  },
  {
    title: "Investir en bourse via un PEA ou une assurance-vie",
    tag: "Long terme",
    read: "7 min",
    excerpt:
      "L'horizon long (>8 ans) change tout. Découvre les ETF MSCI World, la diversification et la fiscalité avantageuse.",
    body: [
      "Un ETF MSCI World te donne accès à ~1500 entreprises de pays développés en une seule ligne. Frais < 0,4%/an.",
      "Le PEA est défiscalisé après 5 ans (hors prélèvements sociaux). L'assurance-vie permet plus de souplesse et une fiscalité douce après 8 ans.",
      "Ne mets jamais en bourse de l'argent dont tu peux avoir besoin dans les 5 ans à venir.",
    ],
    quiz: [
      {
        question: "Un ETF MSCI World donne accès à environ :",
        options: [
          "Une seule entreprise française",
          "~1500 entreprises de pays développés",
          "Uniquement des entreprises technologiques américaines",
          "Des cryptomonnaies diversifiées",
        ],
        correct: 1,
      },
      {
        question: "Le PEA devient défiscalisé (hors prélèvements sociaux) après :",
        options: ["2 ans", "5 ans", "8 ans", "10 ans"],
        correct: 1,
      },
      {
        question: "Quelle règle s'applique à l'argent placé en bourse ?",
        options: [
          "Ne jamais y placer d'argent dont tu peux avoir besoin dans les 5 ans",
          "Tout retirer après 6 mois",
          "Investir uniquement à crédit",
          "Ne placer que sur une seule action",
        ],
        correct: 0,
      },
    ],
  },
  {
    title: "Crypto-actifs : opportunité ou piège ?",
    tag: "Avancé",
    read: "6 min",
    excerpt:
      "Ultra-volatil, non régulé. Si tu y vas, limite-toi à 5% de ton patrimoine et n'investis que ce que tu peux perdre.",
    body: [
      "Bitcoin et Ethereum dominent le marché. Les altcoins sont des paris spéculatifs.",
      "Privilégie des plateformes enregistrées PSAN. Active la double authentification.",
      "Stratégie DCA (Dollar Cost Averaging) : un petit montant fixe chaque mois lisse la volatilité.",
    ],
    quiz: [
      {
        question: "Quelle part maximale de patrimoine l'article suggère-t-il pour les cryptos ?",
        options: ["5%", "25%", "50%", "100%"],
        correct: 0,
      },
      {
        question: "Quel type de plateforme privilégier pour acheter des cryptos ?",
        options: [
          "Une plateforme enregistrée PSAN",
          "N'importe quel site trouvé sur les réseaux sociaux",
          "Une plateforme sans aucune vérification d'identité",
          "Un échange entre particuliers en espèces",
        ],
        correct: 0,
      },
      {
        question: "La stratégie DCA consiste à :",
        options: [
          "Investir tout son argent en une fois au plus bas",
          "Investir un petit montant fixe régulièrement",
          "Vendre dès que le cours baisse",
          "Emprunter pour maximiser la mise",
        ],
        correct: 1,
      },
    ],
  },
  {
    title: "La règle des 50/30/20 expliquée simplement",
    tag: "Bases",
    read: "3 min",
    excerpt:
      "50% besoins, 30% envies, 20% épargne. Un cadre simple pour ne plus finir le mois à découvert.",
    body: [
      "50% pour les charges fixes : loyer, courses, transport, abonnements indispensables.",
      "30% pour les envies : sorties, vêtements, voyages.",
      "20% pour l'épargne et le remboursement de dettes. Si tu n'y arrives pas, vise 10% et grimpe progressivement.",
    ],
    quiz: [
      {
        question: "Dans la règle 50/30/20, à quoi correspondent les 50% ?",
        options: ["Les envies", "L'épargne", "Les charges fixes (besoins)", "Les loisirs"],
        correct: 2,
      },
      {
        question: "Quelle part du revenu est dédiée à l'épargne et au remboursement de dettes ?",
        options: ["10%", "20%", "30%", "50%"],
        correct: 1,
      },
      {
        question: "Si 20% d'épargne est trop ambitieux au début, quel objectif viser ?",
        options: ["0%, abandonner l'épargne", "5%", "10% puis progresser", "50% directement"],
        correct: 2,
      },
    ],
  },
  {
    title: "L'argent n'est pas un chiffre, c'est du temps",
    tag: "Survie financière",
    read: "2 min",
    excerpt:
      "Avant de payer, convertis le prix en heures de travail. 90% des envies perdent instantanément leur charme.",
    body: [
      "💭 Le Mythe : l'argent, c'est juste un nombre sur un écran ou un bout de plastique magique qu'on pose sur un terminal de paiement.",
      "🔦 La Réalité : l'argent, c'est ton temps de vie converti en monnaie. Si tu bosses l'été pour le SMIC (environ 9€ net de l'heure), ce nouveau t-shirt à 36€ ne coûte pas 36€. Il te coûte 4 heures de ta vie à transpirer dans un fast-food ou à porter des cartons. La vraie question n'est pas \"Est-ce que j'ai l'argent ?\", mais \"Est-ce que cet objet vaut 4 heures de mon existence ?\"",
      '🏆 Le Cheat Code : convertis toujours les prix en "heures de travail" avant de valider un panier. Tu verras que 90% des trucs perdent instantanément de leur charme.',
      "🎯 La Mission : prends le dernier objet que tu as acheté pour te faire plaisir. Trouve son prix, divise-le par 9 (le taux horaire du SMIC), et note sur un post-it le nombre d'heures que ça représente.",
    ],
    quiz: [
      {
        question: "Selon l'article, l'argent représente avant tout :",
        options: [
          "Un simple chiffre sur un écran",
          "Ton temps de vie converti en monnaie",
          "Un objet de collection",
          "Une dette envers la banque",
        ],
        correct: 1,
      },
      {
        question: "Le \"Cheat Code\" proposé consiste à :",
        options: [
          "Ne jamais regarder les prix",
          "Convertir les prix en heures de travail avant d'acheter",
          "Payer toujours en plusieurs fois",
          "Demander un crédit avant chaque achat",
        ],
        correct: 1,
      },
      {
        question: "La \"Mission\" du chapitre demande de :",
        options: [
          "Calculer le coût en heures de travail de ton dernier achat plaisir",
          "Ouvrir un compte en bourse",
          "Annuler tous tes abonnements",
          "Emprunter à un ami",
        ],
        correct: 0,
      },
    ],
  },
  {
    title: "L'anatomie d'une banque",
    tag: "Survie financière",
    read: "2 min",
    excerpt:
      "Compte courant ou livret ? Comprends la différence entre le hall de gare et la salle des coffres.",
    body: [
      "💭 Le Mythe : la banque, c'est juste une grosse boîte noire où ton argent dort en attendant que tu l'utilises.",
      "🔦 La Réalité : ta banque te donne deux outils complètement différents. Le \"compte courant\" (relié à ta carte bancaire), c'est le hall de gare : l'argent y transite, ne rapporte absolument rien, et n'attend qu'à être dépensé. Le \"livret\", c'est la salle des coffres : l'argent y est protégé et il fait des petits (les intérêts). Laisser toutes tes économies sur un compte courant, c'est comme laisser ton vélo dans la rue sans cadenas : il finira par disparaître dans des dépenses inutiles.",
      "🏆 Le Cheat Code : ton compte courant doit être une zone de transit, presque vide. Dès que l'argent arrive, transfère tout ce que tu ne prévois pas de dépenser dans le mois vers ton livret.",
      "🎯 La Mission : ouvre l'appli de ta banque. Regarde la différence de solde entre ton compte courant et tes livrets. S'il y a plus d'argent sur le courant que sur l'épargne, fais un virement de 20€ tout de suite vers le livret.",
    ],
    quiz: [
      {
        question: "À quoi le compte courant est-il comparé dans l'article ?",
        options: [
          "Une salle des coffres",
          "Un hall de gare",
          "Un coffre-fort blindé",
          "Un compte d'assurance-vie",
        ],
        correct: 1,
      },
      {
        question: "À quoi le livret est-il comparé ?",
        options: [
          "Un hall de gare",
          "Une salle des coffres où l'argent fait des petits",
          "Un compte bloqué à vie",
          "Une carte de crédit",
        ],
        correct: 1,
      },
      {
        question: "Que recommande le \"Cheat Code\" ?",
        options: [
          "Garder toutes ses économies sur le compte courant",
          "Transférer vers le livret l'argent non prévu pour le mois",
          "Ne jamais utiliser de livret",
          "Fermer son compte courant définitivement",
        ],
        correct: 1,
      },
    ],
  },
  {
    title: "Le Livret Jeune : l'anomalie ultra-rentable",
    tag: "Survie financière",
    read: "2 min",
    excerpt:
      "Entre 12 et 25 ans, tu as droit à un livret défiscalisé souvent mieux rémunéré que le Livret A.",
    body: [
      "💭 Le Mythe : l'épargne, c'est un truc de daron pour acheter une maison dans 20 ans, en plus ça ne rapporte rien.",
      "🔦 La Réalité : entre 12 et 25 ans, tu as droit à une anomalie ultra-rentable du système français : le Livret Jeune. C'est un compte d'épargne où tu peux déposer jusqu'à 1 600€. La banque fixe le taux (souvent meilleur que celui du Livret A), et l'État ne te prend aucun impôt sur ce que ça rapporte. C'est littéralement de l'argent gratuit généré par ton argent, 100% sécurisé.",
      "🏆 Le Cheat Code : atteindre le plafond de ce livret (les 1 600€) doit être ta quête principale dans le jeu de la finance. Une fois rempli, c'est ton bouclier d'invincibilité pour les années à venir (permis, premier appart).",
      "🎯 La Mission : vérifie si tu as un Livret Jeune ouvert. Si oui, regarde son taux d'intérêt dans les détails du compte. Si non, envoie un message à ton conseiller via l'appli pour exiger son ouverture (c'est un droit et c'est gratuit).",
    ],
    quiz: [
      {
        question: "Entre quel âge peut-on bénéficier d'un Livret Jeune ?",
        options: ["0-18 ans", "12-25 ans", "18-30 ans", "16-21 ans"],
        correct: 1,
      },
      {
        question: "Quel est le plafond de dépôt du Livret Jeune ?",
        options: ["1 600€", "12 000€", "22 950€", "10 000€"],
        correct: 0,
      },
      {
        question: "Comment les intérêts du Livret Jeune sont-ils imposés ?",
        options: [
          "Fortement imposés",
          "Aucun impôt sur les intérêts",
          "Imposés à 30% (flat tax)",
          "Selon ta tranche d'imposition",
        ],
        correct: 1,
      },
    ],
  },
  {
    title: "Le piège de la tribu",
    tag: "Survie financière",
    read: "2 min",
    excerpt:
      "Le vrai flex n'est pas ce que tu portes, c'est l'argent que tu as sécurisé en banque.",
    body: [
      '💭 Le Mythe : avoir le dernier iPhone ou des sneakers à 200€ prouve que tu as "réussi" et te fait gagner le respect de ton entourage.',
      "🔦 La Réalité : personne ne s'intéresse réellement à tes chaussures ; les gens ne s'intéressent qu'à l'image qu'ils renvoient eux-mêmes. Lâcher tout ton argent de poche ou ton premier salaire pour un logo, c'est payer une \"taxe d'insécurité\". Tu enrichis une multinationale en te ruinant, juste pour acheter la validation temporaire de gens qui auront oublié ta tenue dans trois jours.",
      "🏆 Le Cheat Code : le vrai flex n'est pas ce que tu portes, c'est l'argent que tu as sécurisé en banque. Un gars en t-shirt basique avec 1 000€ de côté est financièrement plus libre et serein que le gars en survêtement de créateur dont le compte est à sec le 10 du mois.",
      '🎯 La Mission : identifie une dépense que tu allais faire uniquement pour "paraître" (vêtement, soirée, accessoire) et annule-la. Prends cet argent et envoie-le sur ton livret.',
    ],
    quiz: [
      {
        question: "Selon l'article, le \"vrai flex\" c'est :",
        options: [
          "Le dernier iPhone",
          "Des sneakers à 200€",
          "L'argent sécurisé en banque",
          "Des vêtements de marque",
        ],
        correct: 2,
      },
      {
        question: "Acheter uniquement pour \"paraître\" est qualifié dans l'article de :",
        options: ["Investissement malin", "Taxe d'insécurité", "Épargne automatique", "Bon plan"],
        correct: 1,
      },
      {
        question: "Que propose la \"Mission\" du chapitre ?",
        options: [
          "Acheter plus de vêtements de marque",
          "Annuler une dépense \"pour paraître\" et l'épargner",
          "Emprunter pour suivre la tendance",
          "Ignorer complètement ses finances",
        ],
        correct: 1,
      },
    ],
  },
  {
    title: "Les vampires numériques",
    tag: "Survie financière",
    read: "2 min",
    excerpt:
      "5,99€ par mois sur deux ans, c'est plus de 140€. Traque et résilie les abonnements oubliés.",
    body: [
      "💭 Le Mythe : un abonnement Spotify à 5,99€ ou un pass de combat à 8€, c'est que dalle, c'est le prix d'un fast-food.",
      "🔦 La Réalité : le modèle économique du numérique repose sur ton amnésie. Les micro-transactions et les abonnements sont des sangsues. 5,99€ par mois sur deux ans, c'est plus de 140€. Ajoute un service de streaming de jeux, une app de fitness oubliée et des skins : tu perds des centaines d'euros par an sans t'en apercevoir. C'est l'effet \"mort par mille coupures\".",
      "🏆 Le Cheat Code : considère chaque abonnement mensuel comme une fuite dans la coque de ton bateau. Fais une purge violente tous les 6 mois.",
      "🎯 La Mission : prends l'historique de ton compte bancaire sur les 30 derniers jours. Traque les prélèvements automatiques et résilie immédiatement un service que tu as utilisé moins de 2 heures cette semaine.",
    ],
    quiz: [
      {
        question: "Un abonnement à 5,99€/mois sur deux ans représente environ :",
        options: ["50€", "70€", "plus de 140€", "20€"],
        correct: 2,
      },
      {
        question: "Comment l'article nomme-t-il cet effet d'accumulation d'abonnements ?",
        options: [
          "\"mort par mille coupures\"",
          "\"effet boule de neige\"",
          "\"bonus de fidélité\"",
          "\"effet richesse\"",
        ],
        correct: 0,
      },
      {
        question: "Que recommande le \"Cheat Code\" ?",
        options: [
          "Souscrire à plus d'abonnements",
          "Faire une purge des abonnements tous les 6 mois",
          "Ne jamais vérifier ses prélèvements",
          "Payer uniquement en espèces",
        ],
        correct: 1,
      },
    ],
  },
  {
    title: "La fiche de paie du premier job",
    tag: "Survie financière",
    read: "2 min",
    excerpt:
      "Brut vs Net : multiplie toujours le salaire brut par 0,78 pour connaître ton vrai budget.",
    body: [
      "💭 Le Mythe : si l'annonce de mon job d'été affiche \"Salaire : 1 800€ par mois\", je vais recevoir 1 800€ sur mon compte en banque.",
      '🔦 La Réalité : bienvenue dans le monde adulte et la claque du "Brut vs Net". Le salaire "brut" (les 1 800€), c\'est ce que l\'entreprise paie au total. Mais l\'État prend sa part directement à la source (environ 22%) pour financer le système social : la santé, le chômage, la retraite. Ce sont les "cotisations". Ce qui arrive réellement sur ton compte, c\'est le salaire "net" (environ 1 400€).',
      "🏆 Le Cheat Code : quand tu postules ou que tu calcules ton budget, le salaire brut est une illusion. Multiplie toujours le salaire brut annoncé par 0,78 (environ) pour connaître l'argent que tu pourras réellement dépenser.",
      '🎯 La Mission : cherche "convertisseur brut net" sur ton téléphone. Entre un salaire de 2000€ brut, et regarde combien il te resterait exactement en net pour réaliser la différence.',
    ],
    quiz: [
      {
        question: "Le salaire \"brut\" correspond à :",
        options: [
          "Ce qui arrive réellement sur ton compte",
          "Ce que l'entreprise paie au total, avant cotisations",
          "Ton épargne mensuelle",
          "Tes impôts annuels",
        ],
        correct: 1,
      },
      {
        question: "Pour estimer ton salaire net à partir du brut, multiplie-le par environ :",
        options: ["0,5", "0,78", "1,2", "0,9"],
        correct: 1,
      },
      {
        question: "Les cotisations prélevées sur le salaire financent notamment :",
        options: [
          "Les actionnaires de l'entreprise",
          "La santé, le chômage et la retraite",
          "Les abonnements numériques",
          "Les cryptomonnaies",
        ],
        correct: 1,
      },
    ],
  },
  {
    title: 'La règle du "1 jour de réflexion"',
    tag: "Survie financière",
    read: "2 min",
    excerpt:
      "À 23h sur Vinted ou Amazon, ton cerveau est fatigué et les algorithmes le savent. Attends 24h avant d'acheter.",
    body: [
      "💭 Le Mythe : quand j'ai très envie d'un truc en scrollant sur Vinted ou Amazon à 23h, c'est que j'en ai vraiment besoin.",
      "🔦 La Réalité : la nuit, ton cerveau est fatigué, ta volonté est épuisée, et les algorithmes le savent. L'achat en un clic court-circuite ta réflexion, c'est de l'achat impulsif pur dicté par une décharge de dopamine, pas par une nécessité. Tu n'achètes pas le produit, tu achètes le frisson du paiement.",
      "🏆 Le Cheat Code : instaure la règle des 24h. Si un objet te fait de l'œil, mets-le dans ton panier, ferme l'application, et va dormir. Si le lendemain à la même heure tu en as toujours un besoin vital et justifié, achète-le. La plupart du temps, l'envie aura totalement disparu.",
      "🎯 La Mission : détache ta carte bancaire d'Apple Pay / Google Pay et supprime-la des applications e-commerce. Oblige-toi à devoir te lever pour aller chercher le bout de plastique physique à chaque achat. La flemme est ton meilleur bouclier financier.",
    ],
    quiz: [
      {
        question: "Pourquoi les achats nocturnes sont-ils particulièrement risqués ?",
        options: [
          "Les prix sont plus élevés la nuit",
          "Le cerveau est fatigué et la volonté est épuisée",
          "Les boutiques en ligne sont fermées",
          "Les cartes bancaires ne fonctionnent pas la nuit",
        ],
        correct: 1,
      },
      {
        question: "La règle proposée par l'article est d'attendre :",
        options: ["1 semaine", "24h", "1 mois", "1 an"],
        correct: 1,
      },
      {
        question: "Que recommande la \"Mission\" du chapitre ?",
        options: [
          "Activer le paiement en un clic partout",
          "Supprimer sa carte bancaire des applications e-commerce",
          "Augmenter son découvert autorisé",
          "Acheter immédiatement ce qui plaît",
        ],
        correct: 1,
      },
    ],
  },
  {
    title: "Le bouclier anti-découvert",
    tag: "Survie financière",
    read: "2 min",
    excerpt:
      "Le découvert n'est pas une avance, c'est un crédit toxique. Exige une carte à autorisation systématique.",
    body: [
      "💭 Le Mythe : c'est normal d'être parfois à découvert, tout le monde l'est, la banque avance l'argent gentiment.",
      "🔦 La Réalité : le découvert n'est pas une avance, c'est un crédit toxique qui coûte très cher. Si tu n'as plus d'argent mais que tu paies quand même, la banque va te facturer des \"agios\" et des \"frais d'intervention\" (souvent 8€ à chaque fois que ta carte passe dans le rouge). Tu vas perdre de l'argent justement parce que tu n'en as pas. C'est une spirale infernale.",
      '🏆 Le Cheat Code : refuse les cartes bancaires classiques. Exige une "carte à autorisation systématique" (type Maestro ou Visa Electron). Avant chaque paiement, cette carte interroge ton compte : si le solde est insuffisant, le paiement est bloqué. Pas de découvert, donc pas de frais bancaires, jamais.',
      '🎯 La Mission : vérifie ton contrat bancaire ou demande à ton conseiller si ta carte actuelle t\'autorise un "découvert". Si oui, demande à passer immédiatement sur une carte à contrôle de solde systématique.',
    ],
    quiz: [
      {
        question: "Comment l'article décrit-il le découvert bancaire ?",
        options: [
          "Une avance gratuite de la banque",
          "Un crédit toxique qui coûte cher",
          "Un cadeau pour les bons clients",
          "Une forme d'épargne automatique",
        ],
        correct: 1,
      },
      {
        question: "Quels frais la banque facture-t-elle en cas de découvert ?",
        options: [
          "Aucun frais",
          "Des agios et des frais d'intervention",
          "Une prime de fidélité",
          "Un remboursement",
        ],
        correct: 1,
      },
      {
        question: "Quelle carte permet d'éviter tout découvert ?",
        options: [
          "Une carte de crédit classique",
          "Une carte à autorisation systématique",
          "Une carte illimitée",
          "Une carte sans contrôle de solde",
        ],
        correct: 1,
      },
    ],
  },
];

function FormationTab() {
  const [open, setOpen] = useState<number | null>(null);
  const [quizUnlocked, setQuizUnlocked] = useState(false);
  if (open !== null) {
    const a = ARTICLES[open];
    return (
      <section className="glass-strong rounded-3xl p-6 sm:p-8 space-y-4">
        <button
          onClick={() => {
            setOpen(null);
            setQuizUnlocked(false);
          }}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-2"
        >
          <ArrowLeft className="size-4" /> Tous les articles
        </button>
        <div className="text-[10px] uppercase tracking-widest text-[var(--ember-glow)]">
          {a.tag} · {a.read}
        </div>
        <h1 className="font-display text-3xl font-bold">{a.title}</h1>
        <div className="space-y-4 text-white/80 leading-relaxed">
          {a.body.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        {quizUnlocked ? (
          <LessonQuiz quiz={a.quiz} />
        ) : (
          <div className="border-t border-white/10 pt-6 mt-2">
            <button
              onClick={() => setQuizUnlocked(true)}
              className="liquid-tab px-5 py-2.5 font-medium inline-flex items-center gap-2"
            >
              <Sparkles className="size-4" /> Accéder au quiz
            </button>
          </div>
        )}
      </section>
    );
  }
  return (
    <>
      <section className="glass-strong rounded-3xl p-6">
        <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/60">
          <BookOpen className="size-3.5" /> Formation
        </div>
        <h2 className="font-display text-2xl font-bold mt-1">
          Apprends à faire grossir ton épargne
        </h2>
        <p className="text-sm text-white/65 mt-1">
          Le Renard a sélectionné des articles courts pour comprendre où placer l'argent que tu mets
          de côté.
        </p>
      </section>
      <section className="grid sm:grid-cols-2 gap-4">
        {ARTICLES.map((a, i) => (
          <button
            key={a.title}
            onClick={() => {
              setOpen(i);
              setQuizUnlocked(false);
            }}
            className="glass-strong rounded-2xl p-5 text-left hover:-translate-y-0.5 transition-all"
          >
            <div className="text-[10px] uppercase tracking-widest text-[var(--ember-glow)]">
              {a.tag} · {a.read}
            </div>
            <h3 className="font-display font-bold text-lg mt-1.5">{a.title}</h3>
            <p className="text-sm text-white/65 mt-2">{a.excerpt}</p>
            <div className="mt-3 inline-flex items-center gap-1 text-xs text-white/70">
              Lire <ArrowRight className="size-3.5" />
            </div>
          </button>
        ))}
      </section>
    </>
  );
}

// ---------- Quiz de fin de leçon ----------
type QuizQuestion = { question: string; options: string[]; correct: number };

function LessonQuiz({ quiz }: { quiz: QuizQuestion[] }) {
  const [answers, setAnswers] = useState<(number | null)[]>(quiz.map(() => null));
  const [submitted, setSubmitted] = useState(false);

  const score = answers.filter((a, i) => a === quiz[i].correct).length;
  const allAnswered = answers.every((a) => a !== null);

  function selectAnswer(qi: number, oi: number) {
    if (submitted) return;
    setAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)));
  }

  function restart() {
    setAnswers(quiz.map(() => null));
    setSubmitted(false);
  }

  return (
    <section className="border-t border-white/10 pt-6 mt-2 space-y-5">
      <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--ember-glow)]">
        <Sparkles className="size-3.5" /> Quiz
      </div>
      <h2 className="font-display text-xl font-bold">Vérifie ce que tu as retenu</h2>
      {quiz.map((q, qi) => (
        <div key={qi} className="glass rounded-2xl p-4">
          <p className="font-medium mb-3">
            {qi + 1}. {q.question}
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {q.options.map((opt, oi) => {
              const selected = answers[qi] === oi;
              const isCorrect = oi === q.correct;
              let style = "border-white/10 hover:border-white/25";
              if (submitted) {
                if (isCorrect) style = "border-[#52b04a] bg-[#52b04a]/10";
                else if (selected) style = "border-[#e94560] bg-[#e94560]/10";
              } else if (selected) {
                style = "border-white/40 bg-white/5";
              }
              return (
                <button
                  key={oi}
                  onClick={() => selectAnswer(qi, oi)}
                  disabled={submitted}
                  className={`text-left rounded-xl px-3 py-2 text-sm border transition-all flex items-center justify-between gap-2 ${style}`}
                >
                  <span>{opt}</span>
                  {submitted && isCorrect && <Check className="size-4 text-[#52b04a] shrink-0" />}
                  {submitted && selected && !isCorrect && (
                    <X className="size-4 text-[#e94560] shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3">
        {!submitted ? (
          <button
            onClick={() => setSubmitted(true)}
            disabled={!allAnswered}
            className="liquid-tab px-5 py-2.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Valider le quiz
          </button>
        ) : (
          <span className="font-display font-bold text-lg text-[var(--ember-glow)]">
            Score : {score}/{quiz.length}
          </span>
        )}
        {submitted && (
          <button onClick={restart} className="text-xs text-white/60 hover:text-white">
            Recommencer
          </button>
        )}
      </div>
    </section>
  );
}

// ---------- Profile Intro (après dépôt CSV) ----------
function ProfileIntro({
  detected,
  selfDef,
  onContinue,
}: {
  detected: SpenderProfile;
  selfDef: SelfDef | null;
  onContinue: (choice: SelfDef) => void;
}) {
  const [choice, setChoice] = useState<SelfDef | null>(selfDef);
  const color = PROFILE_COLOR[detected];

  return (
    <main className="relative z-10 max-w-2xl mx-auto px-5 pt-6 space-y-6">
      <section
        className="glass-strong rounded-3xl p-8 text-center"
        style={{
          background: `linear-gradient(135deg, color-mix(in oklab, ${color} 22%, transparent), rgba(255,255,255,0.04))`,
        }}
      >
        <img
          src={PROFILE_IMAGE[detected]}
          alt=""
          className="size-24 object-contain mx-auto mb-4 animate-float"
        />
        <div className="text-[10px] uppercase tracking-[0.2em] text-white/60">Profil détecté</div>
        <h1 className="font-display text-xl sm:text-2xl font-semibold mt-2 text-white">
          {PROFILE_LABEL[detected]}
        </h1>
        <p className="text-sm text-white/70 mt-3 max-w-md mx-auto">
          D'après ton relevé, le Renard a identifié ton style de gestion. On affine maintenant ta
          stratégie d'épargne.
        </p>
      </section>

      <section className="glass-strong rounded-3xl p-6 space-y-4">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/60">
            <User className="size-3.5" /> À toi de jouer
          </div>
          <h2 className="font-display text-xl font-bold mt-1">Comment veux-tu épargner ?</h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            {
              id: "pleasure" as SelfDef,
              title: "Je veux me faire plaisir",
              desc: "Épargner sans renoncer aux sorties et achats coup de cœur.",
              color: "#f0a020",
            },
            {
              id: "restrict" as SelfDef,
              title: "Je suis prêt à me restreindre",
              desc: "Réduire les dépenses non essentielles pour atteindre mes objectifs plus vite.",
              color: "#52b04a",
            },
          ].map((opt) => {
            const active = choice === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setChoice(opt.id)}
                className={`text-left rounded-2xl p-4 transition-all border ${active ? "border-white/40 scale-[1.01]" : "border-white/10 hover:border-white/25"}`}
                style={{
                  background: active
                    ? `linear-gradient(135deg, color-mix(in oklab, ${opt.color} 25%, transparent), rgba(255,255,255,0.04))`
                    : "rgba(255,255,255,0.03)",
                }}
              >
                <div className="font-display font-bold" style={{ color: opt.color }}>
                  {opt.title}
                </div>
                <div className="text-xs text-white/65 mt-1.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>

        <button
          disabled={!choice}
          onClick={() => {
            if (choice) onContinue(choice);
          }}
          className="liquid-tab w-full px-6 py-3 font-medium inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continuer vers mon tableau de bord <ArrowRight className="size-4" />
        </button>
      </section>
    </main>
  );
}

// ---------- Compte tab : profil + auto-définition ----------
function CompteTab({
  data,
  detected,
  selfDef,
  setSelfDef,
  fixedCharges,
}: {
  data: Computed;
  detected: SpenderProfile;
  selfDef: SelfDef | null;
  setSelfDef: (v: SelfDef | null) => void;
  fixedCharges: { libelle: string; montant: number }[];
}) {
  const color = PROFILE_COLOR[detected];
  const ratio =
    data.income > 0 ? Math.round(((data.income - data.expense) / data.income) * 100) : 0;
  const advice =
    selfDef === "restrict"
      ? "Mode discipline : le Renard pousse l'épargne automatique au max et te bloque les sorties superflues."
      : selfDef === "pleasure"
        ? "Mode plaisir : tes envies restent prioritaires, le Renard épargne en douceur sur les marges détectées."
        : "Choisis ton style d'épargne pour personnaliser les conseils du Renard.";
  const totalFixed = fixedCharges.reduce((s, c) => s + c.montant, 0);

  return (
    <>
      <section
        className="glass-strong rounded-3xl p-6"
        style={{
          background: `linear-gradient(135deg, color-mix(in oklab, ${color} 22%, transparent), rgba(255,255,255,0.04))`,
        }}
      >
        <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/60">
          <User className="size-3.5" /> Mon profil
        </div>
        <div className="flex items-center gap-3 mt-2">
          <img src={PROFILE_IMAGE[detected]} alt="" className="size-24 object-contain" />
          <h2 className="font-display text-lg font-semibold text-white">
            {PROFILE_LABEL[detected]}
          </h2>
        </div>
        <p className="text-sm text-white/70 mt-2">
          Détecté à partir de tes relevés : tu mets de côté{" "}
          <span className="font-mono font-bold text-white">{ratio}%</span> de tes revenus en
          moyenne.
        </p>
      </section>

      {fixedCharges.length > 0 && (
        <section className="glass-strong rounded-3xl p-6">
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <h3 className="font-display text-lg font-bold">Charges fixes mensuelles</h3>
            <span className="font-mono font-bold text-sm text-[var(--ember-glow)]">
              −{Math.round(totalFixed)}€ / mois
            </span>
          </div>
          <p className="text-xs text-white/60 mb-3">
            Repérées par le Renard dans ton relevé. Elles sont exclues du budget hebdomadaire car
            non pilotables au quotidien.
          </p>
          <ul className="space-y-1.5">
            {fixedCharges.map((c) => (
              <li key={c.libelle} className="flex items-center justify-between text-sm">
                <span className="text-white/75">{c.libelle}</span>
                <span className="font-mono text-white/90">{Math.round(c.montant)}€</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="glass-strong rounded-3xl p-6 space-y-4">
        <h3 className="font-display text-lg font-bold">Ta stratégie d'épargne</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            {
              id: "pleasure" as SelfDef,
              title: "Je veux me faire plaisir",
              desc: "Me faire plaisir est l'une de mes priorités.",
              color: "#f0a020",
            },
            {
              id: "restrict" as SelfDef,
              title: "Je suis prêt à me restreindre",
              desc: "Faire des économies passe avant tout.",
              color: "#52b04a",
            },
          ].map((opt) => {
            const active = selfDef === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setSelfDef(opt.id)}
                className={`text-left rounded-2xl p-4 transition-all border ${active ? "border-white/40" : "border-white/10 hover:border-white/25"}`}
                style={{
                  background: active
                    ? `linear-gradient(135deg, color-mix(in oklab, ${opt.color} 25%, transparent), rgba(255,255,255,0.04))`
                    : "rgba(255,255,255,0.03)",
                }}
              >
                <div className="font-display font-bold" style={{ color: opt.color }}>
                  {opt.title}
                </div>
                <div className="text-xs text-white/65 mt-1.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="glass-strong rounded-3xl p-6">
        <div className="flex items-start gap-4">
          <img src={foxAdvisor} alt="" className="size-16 object-contain shrink-0" />
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[var(--ember-glow)]">
              Le Renard te conseille
            </div>
            <p className="text-sm text-white/80 mt-1.5 inline-flex items-start gap-2">
              <Bell className="size-3.5 mt-0.5 shrink-0" />
              {advice}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

// ---------- Bottom nav ----------
function BottomNav({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const items = [
    { id: "epargne", label: "Épargne", icon: PiggyBank },
    { id: "stats", label: "Stats", icon: BarChart3 },
    { id: "analyse", label: "Conseil", icon: Sparkles },
    { id: "formation", label: "Formation", icon: GraduationCap },
    { id: "compte", label: "Compte", icon: User },
  ] as const satisfies { id: TabId; label: string; icon: typeof PiggyBank }[];
  return (
    <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="glass-strong rounded-full p-2 flex gap-1 sm:gap-2">
        {items.map((it) => {
          const active = tab === it.id;
          const Icon = it.icon;
          return (
            <button
              key={it.id}
              onClick={() => setTab(it.id)}
              className={`liquid-tab px-4 py-2.5 flex flex-col items-center gap-0.5 min-w-[68px] ${active ? "liquid-tab-active" : ""}`}
            >
              <Icon className="size-5" />
              <span className="text-[10px] font-medium">{it.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

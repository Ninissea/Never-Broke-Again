import Papa from "papaparse";

export type RawRow = Record<string, string>;

export type Transaction = {
  id: string;
  date: Date;
  label: string;
  amount: number; // negative = expense, positive = income
  category: Category;
};

export type Category =
  | "Loyer & Charges"
  | "Courses"
  | "Restaurants & Bars"
  | "Transport"
  | "Abonnements"
  | "Shopping"
  | "Loisirs"
  | "Santé"
  | "Revenus"
  | "Virements"
  | "Autre";

const RULES: { cat: Category; kw: RegExp }[] = [
  {
    cat: "Loyer & Charges",
    kw: /loyer|edf|engie|veolia|orange|sfr|free|bouygues|internet|electric|gaz/i,
  },
  {
    cat: "Courses",
    kw: /carrefour|leclerc|auchan|lidl|monoprix|franprix|casino|intermarche|super u|picard/i,
  },
  {
    cat: "Restaurants & Bars",
    kw: /mcdo|burger|kfc|uber eats|deliveroo|restaurant|bar |pub |starbucks|brasserie|sushi/i,
  },
  {
    cat: "Transport",
    kw: /sncf|ratp|uber|bolt|essence|total|shell|bp |parking|blablacar|vinci|navigo/i,
  },
  {
    cat: "Abonnements",
    kw: /netflix|spotify|deezer|amazon prime|disney|youtube|apple|icloud|adobe|microsoft|abonnement/i,
  },
  { cat: "Shopping", kw: /amazon|zara|h&m|fnac|darty|zalando|shein|asos|nike|adidas|decathlon/i },
  {
    cat: "Loisirs",
    kw: /cinema|ugc|pathe|spectacle|concert|theatre|musee|salle de sport|basicfit|fitness/i,
  },
  { cat: "Santé", kw: /pharmacie|medecin|docteur|hopital|dentiste|opticien|mutuelle/i },
  { cat: "Revenus", kw: /salaire|paie|virement recu|caf|bourse|remboursement/i },
  { cat: "Virements", kw: /virement|vir sepa|prelevement/i },
];

// Beaucoup d'exports bancaires (Boursorama notamment) utilisent directement le nom de la
// catégorie comme libellé de transaction ("Nourriture", "Transport", "Loisirs"...) plutôt
// qu'un nom de commerçant. On normalise (minuscules, accents/caractères spéciaux retirés)
// pour reconnaître ces libellés en priorité, avant les règles par mot-clé commerçant.
// La normalisation gère aussi les libellés mal encodés (ex. "TÃ©lÃ©com"), qui se réduisent
// à la même clé que leur version correcte ("Télécom" -> "tlcom").
function normalizeForCategory(label: string): string {
  return label.toLowerCase().replace(/[^a-z]/g, "");
}

const DIRECT_CATEGORY_LABELS: Record<string, Category> = {
  nourriture: "Courses",
  transport: "Transport",
  loisirs: "Loisirs",
  divertissement: "Loisirs",
  shopping: "Shopping",
  loyer: "Loyer & Charges",
  logement: "Loyer & Charges",
  tlcom: "Abonnements",
  telecom: "Abonnements",
  abonnement: "Abonnements",
  abonnements: "Abonnements",
  sant: "Santé",
  scolarit: "Loyer & Charges",
  retrait: "Autre",
  revenus: "Revenus",
  virement: "Virements",
  virements: "Virements",
};

function categorize(label: string, amount: number): Category {
  const direct = DIRECT_CATEGORY_LABELS[normalizeForCategory(label)];
  if (direct) return direct;
  if (amount > 0 && /salaire|paie|virement recu|caf|bourse|remboursement/i.test(label))
    return "Revenus";
  for (const r of RULES) if (r.kw.test(label)) return r.cat;
  return amount > 0 ? "Revenus" : "Autre";
}

const num = (s: string): number => {
  if (!s) return NaN;
  const cleaned = s.replace(/\s/g, "").replace(/[€$£]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? NaN : n;
};

// Répare les libellés mal encodés ("TÃ©lÃ©com" -> "Télécom"), fréquents sur certains
// exports bancaires (texte UTF-8 réinterprété en Latin-1 puis ré-encodé en UTF-8).
function fixMojibake(label: string): string {
  if (!/[ÃÂ]/.test(label)) return label;
  try {
    const bytes = Uint8Array.from(label, (c) => c.charCodeAt(0));
    if ([...bytes].some((b) => b > 0xff)) return label;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return label;
  }
}

const parseDate = (s: string): Date | null => {
  if (!s) return null;
  // try DD/MM/YYYY
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const [, d, mo] = m;
    let y = m[3];
    if (y.length === 2) y = "20" + y;
    const dt = new Date(+y, +mo - 1, +d);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
};

export async function parseCsv(file: File): Promise<Transaction[]> {
  return new Promise((resolve, reject) => {
    // On parse d'abord sans entête : beaucoup d'exports bancaires placent quelques lignes
    // de métadonnées (compte, période...) avant la véritable ligne d'entêtes.
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      delimitersToGuess: [",", ";", "\t", "|"],
      complete: (res) => {
        try {
          const rows = res.data;
          if (!rows.length) return resolve([]);

          let headerIdx = 0;
          for (let i = 0; i < Math.min(rows.length, 20); i++) {
            const cells = rows[i].map((c) => (c || "").trim().toLowerCase());
            const hasDate = cells.some((c) => /date/.test(c));
            const hasAmountOrLabel = cells.some((c) =>
              /montant|amount|valeur|debit|débit|credit|crédit|lib|label|desc|narrative|motif/.test(
                c,
              ),
            );
            if (hasDate && hasAmountOrLabel) {
              headerIdx = i;
              break;
            }
          }

          const headers = rows[headerIdx].map((h) => (h || "").trim().toLowerCase());
          // Les colonnes "date valeur" / "date opération" contiennent "valeur"/"date" : on les
          // exclut des recherches de colonnes montant/libellé pour éviter les faux positifs.
          const dateIdx = headers.findIndex((h) => /date/.test(h));
          const labelIdx = headers.findIndex(
            (h) => !/date/.test(h) && /lib|label|desc|narrative|motif/.test(h),
          );
          const debitIdx = headers.findIndex((h) => !/date/.test(h) && /debit|débit/.test(h));
          const creditIdx = headers.findIndex((h) => !/date/.test(h) && /credit|crédit/.test(h));
          const amountIdx = headers.findIndex(
            (h) => !/date/.test(h) && /montant|amount|valeur/.test(h),
          );

          const dateKey = dateIdx >= 0 ? dateIdx : 0;
          const labelKey = labelIdx >= 0 ? labelIdx : 1;

          const txs: Transaction[] = rows
            .slice(headerIdx + 1)
            .map((cells, i): Transaction | null => {
              const date = parseDate(cells[dateKey]);
              const label = fixMojibake((cells[labelKey] || "").toString().trim());
              if (!date || !label) return null;
              let amount = NaN;
              if (amountIdx >= 0) amount = num(cells[amountIdx]);
              else if (debitIdx >= 0 || creditIdx >= 0) {
                const d = debitIdx >= 0 ? num(cells[debitIdx]) : NaN;
                const c = creditIdx >= 0 ? num(cells[creditIdx]) : NaN;
                if (!isNaN(d) && d !== 0) amount = -Math.abs(d);
                else if (!isNaN(c) && c !== 0) amount = Math.abs(c);
              }
              if (isNaN(amount)) return null;
              return {
                id: `tx-${headerIdx}-${i}`,
                date,
                label,
                amount,
                category: categorize(label, amount),
              };
            })
            .filter((t): t is Transaction => t !== null)
            .sort((a, b) => b.date.getTime() - a.date.getTime());
          resolve(txs);
        } catch (e) {
          reject(e);
        }
      },
      error: reject,
    });
  });
}

export type Insights = {
  income: number;
  expense: number;
  net: number;
  byCategory: { category: Category; total: number; count: number }[];
  topMerchants: { label: string; total: number; count: number }[];
  recurring: { label: string; avg: number; count: number }[];
  savingsSuggestion: number;
  advice: string[];
  monthlySpend: { month: string; total: number }[];
};

export function buildInsights(txs: Transaction[]): Insights {
  const income = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const net = income - expense;

  const catMap = new Map<Category, { total: number; count: number }>();
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const c = catMap.get(t.category) ?? { total: 0, count: 0 };
    c.total += Math.abs(t.amount);
    c.count += 1;
    catMap.set(t.category, c);
  }
  const byCategory = [...catMap.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.total - a.total);

  const merchMap = new Map<string, { total: number; count: number }>();
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const key = t.label
      .split(/\s{2,}|—|-/)[0]
      .slice(0, 28)
      .trim()
      .toUpperCase();
    const m = merchMap.get(key) ?? { total: 0, count: 0 };
    m.total += Math.abs(t.amount);
    m.count += 1;
    merchMap.set(key, m);
  }
  const topMerchants = [...merchMap.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const recurring = [...merchMap.entries()]
    .filter(([, v]) => v.count >= 2)
    .map(([label, v]) => ({ label, avg: v.total / v.count, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Monthly spend
  const monthly = new Map<string, number>();
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const k = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
    monthly.set(k, (monthly.get(k) ?? 0) + Math.abs(t.amount));
  }
  const monthlySpend = [...monthly.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, total]) => ({ month, total }));

  // Savings suggestion: 8% of net positive, or 5% of top discretionary
  const discretionary = byCategory
    .filter((c) =>
      ["Restaurants & Bars", "Shopping", "Loisirs", "Abonnements"].includes(c.category),
    )
    .reduce((s, c) => s + c.total, 0);
  const savingsSuggestion = Math.max(
    Math.round((net > 0 ? net * 0.1 : discretionary * 0.05) / 5) * 5,
    5,
  );

  const advice: string[] = [];
  const topCat = byCategory[0];
  if (topCat) {
    advice.push(
      `Ton plus gros poste : ${topCat.category} (${topCat.total.toFixed(0)} €). Une économie de 15 % te ferait gagner ${(topCat.total * 0.15).toFixed(0)} € par période.`,
    );
  }
  if (recurring.length) {
    advice.push(
      `J'ai repéré ${recurring.length} dépenses récurrentes. Tu peux les piloter d'un coup en activant le mode "Pilote auto".`,
    );
  }
  if (net < 0) {
    advice.push(
      `Tu es à -${Math.abs(net).toFixed(0)} € sur la période. Je te propose d'attaquer en douceur : ${savingsSuggestion} € mis de côté dès le prochain virement.`,
    );
  } else {
    advice.push(
      `Excellent — tu dégages ${net.toFixed(0)} €. Je verrouille ${savingsSuggestion} € sur ton Pot ? Tu peux le débloquer à tout moment.`,
    );
  }
  if (byCategory.find((c) => c.category === "Abonnements" && c.total > 30)) {
    advice.push(
      `Tes abonnements pèsent ${byCategory
        .find((c) => c.category === "Abonnements")!
        .total.toFixed(
          0,
        )} €. Je peux te lister les doublons (Spotify + Deezer ? Netflix + Disney ?).`,
    );
  }

  return {
    income,
    expense,
    net,
    byCategory,
    topMerchants,
    recurring,
    savingsSuggestion,
    advice,
    monthlySpend,
  };
}

export const CATEGORY_COLORS: Record<Category, string> = {
  "Loyer & Charges": "#6366f1",
  Courses: "#10b981",
  "Restaurants & Bars": "#f97316",
  Transport: "#06b6d4",
  Abonnements: "#a855f7",
  Shopping: "#ec4899",
  Loisirs: "#eab308",
  Santé: "#ef4444",
  Revenus: "#22c55e",
  Virements: "#94a3b8",
  Autre: "#64748b",
};

// ============= Auto-Savings Planner =============

export type SavingsGoal = {
  name: string;
  target: number;
  deadline: Date;
};

export type SavingsCadence = "weekly" | "biweekly" | "monthly";

export type SavingsPlan = {
  goal: SavingsGoal;
  cadence: SavingsCadence;
  perOccurrence: number;
  occurrences: { date: Date; amount: number; label: string }[];
  totalSaved: number;
  feasible: boolean;
  avgMonthlyNet: number;
  avgMonthlyDiscretionary: number;
  safeWeeklyCeiling: number;
  rationale: string;
  // Avoid the "rent week" (1-7) and capture stable mid/late month windows
  skipFirstWeek: boolean;
};

/**
 * Computes a smart auto-savings plan.
 * - Analyzes historical cash-flow to derive a "safe" amount to siphon without the user noticing.
 * - Picks a cadence: weekly (smoothest), biweekly (default — skips the rent/salary week), or monthly.
 * - Schedules debits on the 10th and 25th by default (post-rent, pre-weekend) to dodge the volatile first week.
 */
export function buildSavingsPlan(
  txs: Transaction[],
  goal: SavingsGoal,
  preferredCadence: SavingsCadence = "biweekly",
): SavingsPlan {
  // Monthly aggregates
  const monthIncome = new Map<string, number>();
  const monthExpense = new Map<string, number>();
  const monthDiscretionary = new Map<string, number>();
  const DISCRETIONARY: Category[] = ["Restaurants & Bars", "Shopping", "Loisirs"];
  for (const t of txs) {
    const k = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
    if (t.amount > 0) monthIncome.set(k, (monthIncome.get(k) ?? 0) + t.amount);
    else {
      monthExpense.set(k, (monthExpense.get(k) ?? 0) + Math.abs(t.amount));
      if (DISCRETIONARY.includes(t.category))
        monthDiscretionary.set(k, (monthDiscretionary.get(k) ?? 0) + Math.abs(t.amount));
    }
  }
  const months = new Set([...monthIncome.keys(), ...monthExpense.keys()]);
  const n = Math.max(months.size, 1);
  const totalIn = [...monthIncome.values()].reduce((s, v) => s + v, 0);
  const totalOut = [...monthExpense.values()].reduce((s, v) => s + v, 0);
  const totalDisc = [...monthDiscretionary.values()].reduce((s, v) => s + v, 0);
  const avgMonthlyNet = (totalIn - totalOut) / n;
  const avgMonthlyDiscretionary = totalDisc / n;

  // Safe ceiling: 70% of net OR 25% of discretionary, whichever is more generous when positive.
  // If net is negative, fall back to 15% of discretionary (the "painless" reflex).
  const safeMonthlyCeiling =
    avgMonthlyNet > 0
      ? Math.max(avgMonthlyNet * 0.7, avgMonthlyDiscretionary * 0.25)
      : Math.max(avgMonthlyDiscretionary * 0.15, 10);
  const safeWeeklyCeiling = safeMonthlyCeiling / 4.33;

  // Required amount per month to hit goal
  const now = new Date();
  const msPerMonth = 1000 * 60 * 60 * 24 * 30.44;
  const monthsLeft = Math.max((goal.deadline.getTime() - now.getTime()) / msPerMonth, 0.5);
  const requiredMonthly = goal.target / monthsLeft;
  const feasible = requiredMonthly <= safeMonthlyCeiling * 1.05;

  const effectiveMonthly = Math.min(requiredMonthly, safeMonthlyCeiling);

  // Pick cadence
  let cadence: SavingsCadence = preferredCadence;
  if (effectiveMonthly < 20) cadence = "monthly";
  else if (effectiveMonthly > safeMonthlyCeiling * 0.9) cadence = "monthly";

  const perOccurrence =
    cadence === "weekly"
      ? Math.round((effectiveMonthly / 4.33) * 100) / 100
      : cadence === "biweekly"
        ? Math.round((effectiveMonthly / 2) * 100) / 100
        : Math.round(effectiveMonthly * 100) / 100;

  // Build occurrence schedule until deadline
  const occurrences: { date: Date; amount: number; label: string }[] = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const cursor = new Date(start);

  if (cadence === "monthly") {
    cursor.setDate(10);
    if (cursor < start) cursor.setMonth(cursor.getMonth() + 1);
    while (cursor <= goal.deadline && occurrences.length < 60) {
      occurrences.push({ date: new Date(cursor), amount: perOccurrence, label: "Pot épargne" });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else if (cadence === "biweekly") {
    // Two ticks per month — the 10th (post-rent, post-salary) and the 25th (pre-weekend).
    cursor.setDate(10);
    if (cursor < start) cursor.setMonth(cursor.getMonth() + 1);
    while (cursor <= goal.deadline && occurrences.length < 60) {
      const d10 = new Date(cursor.getFullYear(), cursor.getMonth(), 10);
      const d25 = new Date(cursor.getFullYear(), cursor.getMonth(), 25);
      if (d10 >= start && d10 <= goal.deadline)
        occurrences.push({ date: d10, amount: perOccurrence, label: "Pot — mi-mois" });
      if (d25 >= start && d25 <= goal.deadline)
        occurrences.push({ date: d25, amount: perOccurrence, label: "Pot — fin de mois" });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    // weekly — skip the first week of each month (rent / fixed charges absorb the salary)
    const day = cursor.getDay();
    const daysToMonday = (8 - day) % 7 || 7;
    cursor.setDate(cursor.getDate() + daysToMonday);
    while (cursor <= goal.deadline && occurrences.length < 80) {
      if (cursor.getDate() > 7) {
        occurrences.push({ date: new Date(cursor), amount: perOccurrence, label: "Pot — hebdo" });
      }
      cursor.setDate(cursor.getDate() + 7);
    }
  }

  const totalSaved = occurrences.reduce((s, o) => s + o.amount, 0);

  const rationale = feasible
    ? `Sur les ${n} mois analysés tu dégages en moyenne ${avgMonthlyNet.toFixed(0)} € de net. Je peux capter ${effectiveMonthly.toFixed(0)} €/mois sans toucher à tes habitudes — réparti sur ${cadence === "weekly" ? "des semaines stables (hors début de mois)" : cadence === "biweekly" ? "deux dates discrètes (10 & 25)" : "un seul prélèvement mensuel le 10"}.`
    : `Pour atteindre ${goal.target} € d'ici ${goal.deadline.toLocaleDateString("fr-FR")}, il faudrait ${requiredMonthly.toFixed(0)} €/mois — au-dessus du plafond sûr (${safeMonthlyCeiling.toFixed(0)} €). Je vais épargner le maximum prudent. Repousse l'échéance ou réduis la cible pour boucler.`;

  return {
    goal,
    cadence,
    perOccurrence,
    occurrences,
    totalSaved,
    feasible,
    avgMonthlyNet,
    avgMonthlyDiscretionary,
    safeWeeklyCeiling,
    rationale,
    skipFirstWeek: cadence !== "monthly",
  };
}

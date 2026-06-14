import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import foxAdvisor from "@/assets/fox-advisor.png";
import vulpinLogo from "@/assets/vulpin-logo.svg";
const foxIcon = vulpinLogo;
import {
  ShieldCheck,
  Sparkles,
  Flame,
  Brain,
  Upload,
  Lock,
  Building2,
  ArrowRight,
  LineChart,
  Wallet,
  GraduationCap,
  CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vulpin — Survivre financièrement, intelligemment" },
      {
        name: "description",
        content:
          "L'IA d'éducation financière qui tourne 100% en local. Drag & drop ton CSV bancaire, garde le contrôle, construis ton streak d'épargne.",
      },
    ],
  }),
  component: Landing,
});

const TABS = [
  { id: "vision", label: "Vision" },
  { id: "beta", label: "Bêta CSV" },
  { id: "ia", label: "Double IA" },
  { id: "v3", label: "Open Banking" },
  { id: "game", label: "Streak" },
  { id: "b2b", label: "B2B2C" },
];

function Landing() {
  const [active, setActive] = useState("vision");

  const handleTab = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Ambient orbs */}
      <div
        className="glow-orb animate-pulse-glow"
        style={{ background: "var(--ember)", width: 480, height: 480, top: -120, left: -120 }}
      />
      <div
        className="glow-orb animate-pulse-glow"
        style={{
          background: "#3b4fd8",
          width: 520,
          height: 520,
          top: 400,
          right: -180,
          animationDelay: "2s",
        }}
      />
      <div
        className="glow-orb"
        style={{
          background: "var(--ember-glow)",
          width: 380,
          height: 380,
          bottom: -100,
          left: "40%",
        }}
      />

      <Header />

      {/* Liquid glass tabs */}
      <nav className="sticky top-4 z-40 mx-auto mt-4 w-fit px-4">
        <div className="glass-strong flex items-center gap-1 rounded-full p-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => handleTab(t.id)}
              className={`liquid-tab px-4 py-2 text-xs sm:text-sm font-semibold tracking-wide ${
                active === t.id
                  ? "liquid-tab-active text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6">
        <Hero />
        <section id="vision">
          <Vision />
        </section>
        <section id="beta">
          <BetaCsv />
        </section>
        <section id="ia">
          <DoubleIa />
        </section>
        <section id="v3">
          <OpenBanking />
        </section>
        <section id="game">
          <Streak />
        </section>
        <section id="b2b">
          <B2B />
        </section>
        <CTA />
        <Footer />
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="relative z-30 mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 pt-6">
      <div className="flex items-center gap-2.5">
        <img
          src={foxIcon}
          alt="Vulpin"
          width={36}
          height={36}
          className="drop-shadow-[0_4px_12px_rgba(255,140,60,0.45)]"
        />
        <span className="font-display text-lg font-bold tracking-tight">
          <span className="text-gradient-ember">Vulpin</span>
        </span>
      </div>
      <div className="hidden sm:flex items-center gap-3 text-sm">
        <span className="glass rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <Lock className="inline h-3 w-3 mr-1" /> 100% local · Zéro cloud
        </span>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-8 items-center pt-16 lg:pt-24 pb-24">
      <div>
        <div className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium mb-6">
          <Sparkles className="h-3.5 w-3.5 text-[var(--ember)]" />
          Fintech · EdTech · Cybersécurité
        </div>
        <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.02] tracking-tight">
          Survivre financièrement, <span className="text-gradient-ember">intelligemment.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-xl leading-relaxed">
          Le premier conseiller financier IA qui ne quitte{" "}
          <em className="not-italic font-semibold text-foreground">jamais</em> ton ordinateur. Pour
          les étudiants et jeunes actifs entre 0 € et le salaire médian.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/app"
            className="group inline-flex items-center gap-2 rounded-full bg-[var(--ember)] px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] hover:scale-[1.02] transition"
          >
            Lancer l'app
            <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition" />
          </Link>
          <Link
            to="/app"
            className="glass inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold hover:bg-white/10 transition"
          >
            <Upload className="h-4 w-4" /> Tester avec mon CSV
          </Link>
        </div>
        <div className="mt-10 flex items-center gap-6 text-xs text-muted-foreground">
          <Stat value="0€" label="quitte ton PC" />
          <Stat value="2x" label="moteurs IA" />
          <Stat value="DSP2" label="conforme" />
        </div>
      </div>

      <div className="relative">
        <div className="absolute inset-0 -z-10 rounded-full bg-[radial-gradient(circle,var(--ember-glow)_0%,transparent_60%)] opacity-30 blur-3xl" />
        <img
          src={foxAdvisor}
          alt="Mascotte renard conseiller financier"
          width={1024}
          height={1536}
          className="relative mx-auto max-h-[620px] w-auto animate-float drop-shadow-[0_30px_60px_rgba(0,0,0,0.5)]"
        />
        {/* Floating chip */}
        <div
          className="glass-strong absolute top-10 -left-2 sm:left-0 rounded-2xl px-4 py-3 animate-float"
          style={{ animationDelay: "1s" }}
        >
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-[var(--ember)]" />
            <div>
              <div className="text-xs text-muted-foreground">Streak</div>
              <div className="text-sm font-bold">12 semaines</div>
            </div>
          </div>
        </div>
        <div
          className="glass-strong absolute bottom-16 -right-2 sm:right-0 rounded-2xl px-4 py-3 animate-float"
          style={{ animationDelay: "2.5s" }}
        >
          <div className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-[var(--ember-glow)]" />
            <div>
              <div className="text-xs text-muted-foreground">Économisé</div>
              <div className="text-sm font-bold">+ 184 €</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-display text-2xl font-bold text-gradient-ember">{value}</div>
      <div className="uppercase tracking-wider">{label}</div>
    </div>
  );
}

function SectionTitle({
  kicker,
  title,
  subtitle,
}: {
  kicker: string;
  title: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="max-w-3xl mx-auto text-center mb-14">
      <div className="glass inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ember)]">
        {kicker}
      </div>
      <h2 className="mt-4 font-display text-4xl sm:text-5xl font-bold tracking-tight">{title}</h2>
      {subtitle && <p className="mt-4 text-muted-foreground text-lg leading-relaxed">{subtitle}</p>}
    </div>
  );
}

function Vision() {
  const problems = [
    {
      icon: GraduationCap,
      t: "Zéro éducation",
      d: "Les jeunes ne sont pas formés à gérer leur argent.",
    },
    {
      icon: Wallet,
      t: "Illusion digitale",
      d: "Le paiement dématérialisé fait perdre la notion de dépense.",
    },
    {
      icon: Flame,
      t: "Épargne abandonnée",
      d: "La majorité des tentatives ne tiennent pas plus d'un mois.",
    },
    {
      icon: Sparkles,
      t: "Pression sociale",
      d: "Sorties, FOMO, achats compulsifs — un piège quotidien.",
    },
  ];
  return (
    <div className="py-24">
      <SectionTitle
        kicker="Le constat"
        title={
          <>
            Une génération <span className="text-gradient-ember">livrée à elle-même.</span>
          </>
        }
        subtitle="On vise la survie financière au quotidien, pas la gestion de patrimoine. Le terrain de jeu : 0 € à salaire médian."
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {problems.map((p) => (
          <div key={p.t} className="glass rounded-3xl p-6 hover:bg-white/10 transition">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--ember)]/15 text-[var(--ember)] mb-4">
              <p.icon className="h-5 w-5" />
            </div>
            <h3 className="font-display text-lg font-semibold">{p.t}</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{p.d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function BetaCsv() {
  return (
    <div className="py-24">
      <SectionTitle
        kicker="Phase Bêta"
        title={
          <>
            Drag & drop ton CSV. <span className="text-gradient-ember">Rien ne sort.</span>
          </>
        }
        subtitle="Avant l'Open Banking, on prouve le concept. Tu télécharges tes relevés depuis ta banque, tu les glisses, l'IA analyse — en local."
      />
      <div className="grid lg:grid-cols-2 gap-6 items-stretch">
        <div className="glass-strong rounded-3xl p-8 lg:p-10 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--ember)/0.18,transparent_60%)]" />
          <div className="relative">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-[var(--ember)]" /> Garantie publique
            </div>
            <h3 className="mt-3 font-display text-3xl font-bold">Zéro Cloud. Zéro fuite.</h3>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Le fichier CSV ne quitte jamais ton ordinateur. Pas de serveur, pas d'upload, pas de
              risque. L'argument massue qui convainc même les profils techniques.
            </p>
            <ul className="mt-6 space-y-3">
              {["Traitement on-device", "Aucune télémétrie financière", "Audit ouvert aux DSI"].map(
                (x) => (
                  <li key={x} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-[var(--ember-glow)]" /> {x}
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>

        <div className="glass rounded-3xl p-8 border-dashed">
          <div className="flex flex-col items-center justify-center h-full text-center py-12 rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.02]">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--ember)]/15 text-[var(--ember)] mb-5">
              <Upload className="h-7 w-7" />
            </div>
            <div className="font-display text-xl font-semibold">Dépose ton relevé bancaire</div>
            <div className="text-sm text-muted-foreground mt-2">.csv · traité localement</div>
            <Link
              to="/app"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--ember)] px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Ouvrir l'app
            </Link>
            <div className="mt-6 grid grid-cols-3 gap-3 w-full max-w-sm">
              {["Compte courant", "Épargne", "Projets"].map((c) => (
                <div
                  key={c}
                  className="glass rounded-xl py-2 text-[11px] font-medium text-muted-foreground"
                >
                  {c}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DoubleIa() {
  const layers = [
    {
      icon: Brain,
      t: "Machine Learning",
      c: "Catégorisation automatique des transactions, prédiction budgétaire fiable.",
    },
    {
      icon: Sparkles,
      t: "Reinforcement Learning",
      c: "S'adapte à toi : refuse une épargne et l'IA ajuste sa politique.",
    },
    {
      icon: ShieldCheck,
      t: "LLM quantifié",
      c: "Tourne sur ton NPU ou un serveur isolé. Conseils sans fuite.",
    },
  ];
  return (
    <div className="py-24">
      <SectionTitle
        kicker="Architecture"
        title={
          <>
            Une <span className="text-gradient-ember">double intelligence</span> hybride
          </>
        }
        subtitle="Maths prédictives pour la fiabilité, génératif pour la personnalité. Le meilleur des deux mondes — sans compromis sur la vie privée."
      />
      <div className="grid md:grid-cols-3 gap-5">
        {layers.map((l, i) => (
          <div key={l.t} className="glass-strong rounded-3xl p-7 relative overflow-hidden group">
            <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-[var(--ember)]/20 blur-2xl group-hover:bg-[var(--ember)]/35 transition" />
            <div className="relative">
              <div className="text-xs font-mono text-[var(--ember)]">0{i + 1}</div>
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--ember)] to-[var(--ember-glow)] text-primary-foreground mt-3 mb-4">
                <l.icon className="h-5 w-5" />
              </div>
              <h3 className="font-display text-xl font-bold">{l.t}</h3>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{l.c}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpenBanking() {
  const steps = [
    { n: "AIS", t: "Synchronisation tokenisée", d: "Powens / Plaid · OAuth2 en arrière-plan." },
    {
      n: "PIS",
      t: "Exécution en un clic",
      d: '"Transfère 15 € vers ton pot Épargne" — biométrie SCA, c\'est parti.',
    },
    {
      n: "B2B2C",
      t: "Coût absorbé",
      d: "La banque partenaire paie les frais Open Banking. Toi, rien.",
    },
  ];
  return (
    <div className="py-24">
      <SectionTitle
        kicker="V3 · DSP2"
        title={
          <>
            Open Banking <span className="text-gradient-ember">frictionless</span>
          </>
        }
        subtitle="Une fois la Bêta validée, on passe à l'automatisation totale. Légal, sécurisé, instantané."
      />
      <div className="glass-strong rounded-3xl p-8 lg:p-12">
        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((s, i) => (
            <div key={s.n} className="relative">
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-6 left-full w-full h-px bg-gradient-to-r from-[var(--ember)]/40 to-transparent" />
              )}
              <div className="liquid-tab inline-flex items-center justify-center h-12 w-12 rounded-full font-mono text-xs font-bold text-[var(--ember)]">
                {s.n}
              </div>
              <h3 className="mt-4 font-display text-xl font-bold">{s.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Streak() {
  const days = ["L", "M", "M", "J", "V", "S", "D"];
  return (
    <div className="py-24">
      <SectionTitle
        kicker="Gamification"
        title={
          <>
            Garde la <span className="text-gradient-ember">flamme</span> allumée
          </>
        }
        subtitle="Un streak hebdomadaire, un calendrier visuel, du cashback boosté chez les partenaires. L'engagement par le plaisir."
      />
      <div className="grid lg:grid-cols-[1fr_1.3fr] gap-6 items-center">
        <div className="glass-strong rounded-3xl p-8 text-center">
          <Flame className="mx-auto h-16 w-16 text-[var(--ember)] drop-shadow-[0_0_24px_var(--ember)]" />
          <div className="mt-4 font-display text-6xl font-bold text-gradient-ember">12</div>
          <div className="text-sm uppercase tracking-widest text-muted-foreground">
            semaines d'affilée
          </div>
          <div className="mt-6 grid grid-cols-7 gap-2">
            {days.map((d, i) => (
              <div
                key={i}
                className={`aspect-square rounded-xl flex items-center justify-center text-xs font-semibold ${
                  i < 5
                    ? "bg-gradient-to-br from-[var(--ember)] to-[var(--ember-glow)] text-primary-foreground shadow-[var(--shadow-glow)]"
                    : "glass text-muted-foreground"
                }`}
              >
                {d}
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          {[
            {
              t: "Profilage psychologique continu",
              d: "L'IA analyse 6 mois de relevés à l'inscription, puis affine ton profil au fil du temps.",
            },
            {
              t: "Pont vers l'investissement",
              d: "Budget stabilisé ? Le module éducatif propose des stratégies adaptées à tes excédents.",
            },
            {
              t: "Récompenses partenaires",
              d: "Maintiens la flamme : débloque du cashback boosté et des avantages exclusifs.",
            },
          ].map((x) => (
            <div
              key={x.t}
              className="glass rounded-2xl p-5 flex gap-4 items-start hover:bg-white/10 transition"
            >
              <CheckCircle2 className="h-5 w-5 text-[var(--ember-glow)] shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">{x.t}</div>
                <div className="text-sm text-muted-foreground mt-1 leading-relaxed">{x.d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function B2B() {
  const clients = ["Néo-banques", "Mutuelles", "Assurances", "Écoles", "CROUS"];
  return (
    <div className="py-24">
      <SectionTitle
        kicker="Modèle"
        title={
          <>
            Vendu en <span className="text-gradient-ember">marque blanche</span>
          </>
        }
        subtitle="SDK Front-end + Edge IA. La conformité RGPD totale est l'argument qui débloque les DSI."
      />
      <div className="glass-strong rounded-3xl p-8 lg:p-12 relative overflow-hidden">
        <Building2 className="absolute -right-10 -bottom-10 h-64 w-64 text-white/[0.03]" />
        <div className="relative grid md:grid-cols-2 gap-10">
          <div>
            <h3 className="font-display text-2xl font-bold">Les clients payeurs</h3>
            <div className="mt-5 flex flex-wrap gap-2">
              {clients.map((c) => (
                <span key={c} className="liquid-tab px-4 py-2 text-sm font-semibold">
                  {c}
                </span>
              ))}
            </div>
            <p className="mt-6 text-sm text-muted-foreground leading-relaxed">
              Les néo-banques y gagnent doublement : elles ne tirent pas profit des découverts et
              cherchent à proposer de l'investissement dès les plus petits montants.
            </p>
          </div>
          <div>
            <h3 className="font-display text-2xl font-bold">L'argument de conformité</h3>
            <ul className="mt-5 space-y-3">
              {[
                "Edge AI · données financières jamais sur cloud public",
                "RGPD total · annule le risque de fuite générative",
                "Coûts API Open Banking absorbés par le partenaire",
              ].map((x) => (
                <li key={x} className="flex gap-3 text-sm">
                  <ShieldCheck className="h-5 w-5 text-[var(--ember)] shrink-0" /> {x}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function CTA() {
  return (
    <div className="py-24">
      <div className="glass-strong rounded-[2.5rem] p-10 lg:p-16 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--ember)/0.18,transparent_60%)]" />
        <div className="relative">
          <img
            src={foxIcon}
            alt=""
            width={72}
            height={72}
            className="mx-auto mb-6 animate-float"
            loading="lazy"
          />
          <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-tight">
            Prêt à ne <span className="text-gradient-ember">plus jamais être à sec</span> ?
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            Rejoins les premiers testeurs. Coloc, BDE, junior-entreprise : on cherche les profils
            qui vont casser notre IA.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Link
              to="/app"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--ember)] px-7 py-3.5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] hover:scale-[1.02] transition"
            >
              Lancer l'app <ArrowRight className="h-4 w-4" />
            </Link>
            <button className="glass inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold hover:bg-white/10 transition">
              Parler à un partenaire
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="py-10 text-center text-xs text-muted-foreground">
      © {new Date().getFullYear()} Vulpin · Edge AI · DSP2 · RGPD
    </footer>
  );
}

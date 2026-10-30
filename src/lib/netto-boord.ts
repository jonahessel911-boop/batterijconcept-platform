import { addDays } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import { normalizeProjectStatus } from "@/lib/labels";
import {
  resolveBetaalwijze,
  type Betaalwijze,
} from "@/lib/project-status-config";
import {
  isSchouwdagDefinitief,
  schouwWeekFromDate,
} from "@/lib/schouw-week";
import type { ProjectStatus } from "@/types/database";
import { isAanbetalingFactuurOmschrijving } from "@/lib/aanbetaling";

/** Standaard totale commissie = 10% van omzet (excl. btw). */
export const NETTO_COMMISSIE_PCT = 0.1;

/** Eerste commissie-tranche bij betaalde aanbetaling. */
export const NETTO_AANBETALING_COMMISSIE = 250;

/** Adviseur.commissie_pct (bijv. 12) → fractie; fallback standaard 10%. */
export function commissiePctToFraction(
  pct: number | null | undefined
): number {
  const n = Number(pct);
  if (!Number.isFinite(n) || n <= 0) return NETTO_COMMISSIE_PCT;
  // Al als fractie opgeslagen (0.12) óf als procent (12)
  if (n > 0 && n <= 1) return n;
  return Math.min(n, 100) / 100;
}

export type NettoVorm = "EM" | "WF";

export type NettoFaseKey = "f1" | "f2" | "f3" | "f4";

export type NettoFaseTaak = {
  id: string;
  label: string;
  done: boolean;
  doneAt: string | null;
  detail?: string | null;
};

export type NettoFase = {
  key: NettoFaseKey;
  label: string;
  /** null = niet van toepassing (bv. F1 bij EM) */
  applicable: boolean;
  taken: NettoFaseTaak[];
  done: number;
  total: number;
};

export type NettoBoardStatus = "netto" | "actief" | "geannuleerd";

export type NettoBoardRow = {
  id: string;
  offerte_id: string;
  project_id: string | null;
  lead_id: string;
  klant_naam: string;
  plaats: string | null;
  vorm: NettoVorm;
  bedrag_ex_btw: number;
  bedrag_inc_btw: number;
  adviseur_id: string | null;
  adviseur_naam: string | null;
  board_status: NettoBoardStatus;
  status_sinds: string | null;
  schouw_at: string | null;
  schouw_jaar: number | null;
  schouw_week: number | null;
  installatie_at: string | null;
  factuur_verstuurd_at: string | null;
  factuur_betaald_at: string | null;
  aanbetaling_betaald: boolean;
  aanbetaling_factuur_id: string | null;
  /** Tranche A creditfactuur (aanbetaling). */
  creditfactuur_id: string | null;
  creditfactuur_nummer: string | null;
  /** Tranche B creditfactuur (rest na netto sale). */
  creditfactuur_b_id: string | null;
  creditfactuur_b_nummer: string | null;
  /** Effectief commissie-% (bijv. 12), voor weergave in UI. */
  commissie_pct: number;
  commissie_verwacht: number;
  commissie_tranche_a: number;
  commissie_tranche_b: number;
  commissie_tranche_a_triggered: boolean;
  commissie_tranche_b_triggered: boolean;
  /** Tranche A creditfactuur status=betaald (uitbetaling naar adviseur). */
  commissie_tranche_a_uitbetaald: boolean;
  /** Tranche B creditfactuur status=betaald (uitbetaling naar adviseur). */
  commissie_tranche_b_uitbetaald: boolean;
  commissie_verdiend: number;
  /** Som van getriggerde tranches waarvan de CF status=betaald is. */
  commissie_uitbetaald: number;
  /** Restcommissie (tranche B) die nog niet is uitbetaald aan de adviseur. */
  commissie_rest_open: number;
  fases: NettoFase[];
  progress_done: number;
  progress_total: number;
  progress_pct: number;
  offerte_nummer: string | null;
  project_nummer: string | null;
  project_status: ProjectStatus | null;
  ondertekend_op: string | null;
  geannuleerd: boolean;
};

function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

/** Eerstvolgende woensdag (Amsterdam). Vandaag woensdag → volgende week. */
export function nextWednesdayYmd(from: Date = new Date()): string {
  const local = toZonedTime(from, AMSTERDAM_TZ);
  const dow = local.getDay(); // 0 zo … 3 wo
  let add = (3 - dow + 7) % 7;
  if (add === 0) add = 7;
  return ymdAmsterdam(addDays(local, add));
}

export function formatEuroNl(n: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

/** Planmoment voor fase-labels: `6/10/2026 - 10.00` (Amsterdam). */
export function formatNettoPlanMoment(
  iso: string | null | undefined
): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const stamp = formatInTimeZone(d, AMSTERDAM_TZ, "d/M/yyyy - HH.mm");
    return stamp;
  } catch {
    return null;
  }
}

function withPlanMoment(base: string, iso: string | null | undefined): string {
  const stamp = formatNettoPlanMoment(iso);
  return stamp ? `${base} - ${stamp}` : base;
}

export function commissieVerwacht(
  omzetExBtw: number,
  commissiePct?: number | null
): number {
  const frac = commissiePctToFraction(commissiePct);
  return Math.round(omzetExBtw * frac * 100) / 100;
}

/** Tranche A = min(€250, totaal verwacht). */
export function commissieTrancheA(
  omzetExBtw: number,
  commissiePct?: number | null
): number {
  return Math.min(
    NETTO_AANBETALING_COMMISSIE,
    commissieVerwacht(omzetExBtw, commissiePct)
  );
}

/** Tranche B = rest na Tranche A. */
export function commissieTrancheB(
  omzetExBtw: number,
  commissiePct?: number | null
): number {
  return (
    Math.round(
      (commissieVerwacht(omzetExBtw, commissiePct) -
        commissieTrancheA(omzetExBtw, commissiePct)) *
        100
    ) / 100
  );
}

export function resolveNettoCommissie(opts: {
  omzetExBtw: number;
  geannuleerd: boolean;
  aanbetalingBetaald: boolean;
  /** Restfactuur betaald óf installatie voltooid → tranche B. */
  restOfInstallatieDone: boolean;
  /** Adviseur.commissie_pct (bijv. 12 voor eerste sales). */
  commissiePct?: number | null;
}): {
  verwacht: number;
  tranche_a: number;
  tranche_b: number;
  tranche_a_triggered: boolean;
  tranche_b_triggered: boolean;
  verdiend: number;
} {
  const pct = opts.commissiePct;
  const tranche_a = commissieTrancheA(opts.omzetExBtw, pct);
  const tranche_b = commissieTrancheB(opts.omzetExBtw, pct);
  if (opts.geannuleerd) {
    return {
      verwacht: 0,
      tranche_a,
      tranche_b,
      tranche_a_triggered: false,
      tranche_b_triggered: false,
      verdiend: 0,
    };
  }
  const tranche_a_triggered = opts.aanbetalingBetaald;
  const tranche_b_triggered = opts.restOfInstallatieDone;
  const verdiend =
    (tranche_a_triggered ? tranche_a : 0) +
    (tranche_b_triggered ? tranche_b : 0);
  return {
    verwacht: commissieVerwacht(opts.omzetExBtw, pct),
    tranche_a,
    tranche_b,
    tranche_a_triggered,
    tranche_b_triggered,
    verdiend: Math.round(verdiend * 100) / 100,
  };
}

const PIPELINE: ProjectStatus[] = [
  "schouwweek_inplannen",
  "aanbetaling_verstuurd",
  "aanbetaling_betaald",
  "warmtefonds_afspraak_ingepland",
  "warmtefonds_aangevraagd",
  "warmtefonds_in_behandeling",
  "warmtefonds_goedgekeurd",
  "opstarten_voltooid_afwachten_wf",
  "schouwdag_ingepland",
  "schouw_voltooid",
  "restfactuur_verstuurd",
  "restfactuur_betaald",
  "materiaal_besteld",
  "installatie_ingepland",
  "installatie_voltooid",
  "review_gevraagd",
  "afgerond",
];

/** Warmtefonds-subpipeline — niet via algemene pipeline-rank afleiden. */
const WF_PIPELINE: ProjectStatus[] = [
  "warmtefonds_afspraak_ingepland",
  "warmtefonds_aangevraagd",
  "warmtefonds_in_behandeling",
  "warmtefonds_goedgekeurd",
];

export type WarmtefondsMilestones = {
  afspraak: boolean;
  aangevraagd: boolean;
  behandeling: boolean;
  goedgekeurd: boolean;
  afgewezen: boolean;
};

function wfStatusIndex(st: ProjectStatus): number {
  if (st === "warmtefonds_afgewezen") return WF_PIPELINE.length;
  return WF_PIPELINE.indexOf(st);
}

/** Bepaal WF-stappen op basis van huidige status + historie (lead_events), niet pipeline-rank. */
export function resolveWarmtefondsMilestones(opts: {
  projectStatus: string | null;
  aangevraagdOp?: string | null;
  /** Statussen die ooit op deze lead zijn gezet (meta.naar uit lead_events). */
  history?: Iterable<string> | null;
}): WarmtefondsMilestones {
  const st = normalizeProjectStatus(opts.projectStatus);
  const hist = new Set<string>(opts.history || []);
  hist.add(st);

  const afgewezen =
    st === "warmtefonds_afgewezen" || hist.has("warmtefonds_afgewezen");
  const idx = wfStatusIndex(st);
  const onWfBranch = idx >= 0;

  const seen = (s: ProjectStatus) => hist.has(s);

  const afspraak =
    afgewezen ||
    (onWfBranch && idx >= 0) ||
    seen("warmtefonds_afspraak_ingepland") ||
    seen("warmtefonds_aangevraagd") ||
    seen("warmtefonds_in_behandeling") ||
    seen("warmtefonds_goedgekeurd");

  const aangevraagd =
    afgewezen ||
    (onWfBranch && idx >= 1) ||
    Boolean(opts.aangevraagdOp) ||
    seen("warmtefonds_aangevraagd") ||
    seen("warmtefonds_in_behandeling") ||
    seen("warmtefonds_goedgekeurd");

  const behandeling =
    afgewezen ||
    (onWfBranch && idx >= 2) ||
    seen("warmtefonds_in_behandeling") ||
    seen("warmtefonds_goedgekeurd");

  const goedgekeurd =
    (onWfBranch && idx >= 3) || seen("warmtefonds_goedgekeurd");

  return { afspraak, aangevraagd, behandeling, goedgekeurd, afgewezen };
}

function rank(status: string | null | undefined): number {
  const st = normalizeProjectStatus(status);
  const i = PIPELINE.indexOf(st);
  return i >= 0 ? i : -1;
}

function reached(
  status: string | null | undefined,
  target: ProjectStatus
): boolean {
  const st = normalizeProjectStatus(status);
  if (st === "annulering") return false;
  if (st === "service" || st === "review_gevraagd" || st === "afgerond" || st === "installatie_voltooid") {
    return rank(target) <= rank("installatie_voltooid");
  }
  return rank(st) >= rank(target);
}

export function resolveNettoVorm(opts: {
  betaalwijze?: string | null;
  financieringVoorbehoud?: boolean | null;
  leadStatus?: string | null;
}): NettoVorm {
  const bw = resolveBetaalwijze({
    betaalwijze: opts.betaalwijze as Betaalwijze | null | undefined,
    leadStatus: opts.leadStatus,
    financieringVoorbehoud: opts.financieringVoorbehoud,
  });
  return bw === "eigen_middelen" ? "EM" : "WF";
}

type BuildCtx = {
  projectStatus: string | null;
  vorm: NettoVorm;
  geannuleerd: boolean;
  aanbetalingVerstuurd: boolean;
  aanbetalingVerstuurdOp: string | null;
  aanbetalingBetaald: boolean;
  aanbetalingBetaaldOp: string | null;
  restVerstuurd: boolean;
  restBetaald: boolean;
  restBetaaldOp: string | null;
  restVerstuurdOp: string | null;
  schouwAt: string | null;
  schouwJaar: number | null;
  schouwWeek: number | null;
  installatieAt: string | null;
  /** Moment waarop installatie als uitgevoerd is gemarkeerd (netto sale). */
  installatieVoltooidAt?: string | null;
  warmtefondsAfgewezen: boolean;
  warmtefondsAangevraagdOp: string | null;
  warmtefondsHistory?: Iterable<string> | null;
  schouwFormulierGeupload: boolean;
  schouwFormulierAt: string | null;
  btwTerugvragenAt?: string | null;
  overstapDynamischeLeverancierAt?: string | null;
  reviewGevraagdAt?: string | null;
};

function taak(
  id: string,
  label: string,
  done: boolean,
  doneAt: string | null = null,
  detail: string | null = null
): NettoFaseTaak {
  return { id, label, done, doneAt, detail };
}

export function buildNettoFases(ctx: BuildCtx): NettoFase[] {
  const st = ctx.projectStatus;
  const cancelled = ctx.geannuleerd;
  const wf = resolveWarmtefondsMilestones({
    projectStatus: st,
    aangevraagdOp: ctx.warmtefondsAangevraagdOp,
    history: ctx.warmtefondsHistory,
  });

  const f1Taken: NettoFaseTaak[] =
    ctx.vorm === "EM"
      ? [
          taak(
            "aanbetaling_verstuurd",
            "1.1 Aanbetaling verstuurd",
            !cancelled &&
              (ctx.aanbetalingVerstuurd ||
                reached(st, "aanbetaling_verstuurd") ||
                reached(st, "aanbetaling_betaald")),
            ctx.aanbetalingVerstuurdOp
          ),
          taak(
            "aanbetaling",
            "1.2 Aanbetaling ontvangen",
            !cancelled && ctx.aanbetalingBetaald,
            ctx.aanbetalingBetaaldOp
          ),
        ]
      : [
          taak(
            "aanbetaling_verstuurd",
            "1.1 Aanbetaling verstuurd",
            !cancelled &&
              (ctx.aanbetalingVerstuurd ||
                reached(st, "aanbetaling_verstuurd") ||
                reached(st, "aanbetaling_betaald")),
            ctx.aanbetalingVerstuurdOp
          ),
          taak(
            "aanbetaling",
            "1.2 Aanbetaling ontvangen",
            !cancelled && ctx.aanbetalingBetaald,
            ctx.aanbetalingBetaaldOp
          ),
          taak(
            "wf_afspraak",
            "1.3 Warmtefonds afspraak ingepland",
            !cancelled && wf.afspraak
          ),
          taak(
            "wf_aanvraag",
            "1.4 Warmtefonds aangevraagd",
            !cancelled && wf.aangevraagd,
            ctx.warmtefondsAangevraagdOp
          ),
          taak(
            "wf_behandeling",
            "1.5 Warmtefonds in behandeling",
            !cancelled && wf.behandeling
          ),
          taak(
            "wf_ok",
            "1.6 Warmtefonds goedgekeurd",
            !cancelled && wf.goedgekeurd,
            null,
            wf.afgewezen ? "Afgewezen" : null
          ),
        ];

  const schouwDefinitief = isSchouwdagDefinitief({
    schouw_at: ctx.schouwAt,
    schouw_jaar: ctx.schouwJaar,
    schouw_week: ctx.schouwWeek,
  });
  const schouwWeek =
    ctx.schouwJaar && ctx.schouwWeek
      ? { jaar: ctx.schouwJaar, week: ctx.schouwWeek }
      : schouwDefinitief && ctx.schouwAt
        ? schouwWeekFromDate(ctx.schouwAt)
        : null;
  const schouwWeekGezet = Boolean(schouwWeek);
  const installatieGepland = Boolean(ctx.installatieAt);

  const f2Taken: NettoFaseTaak[] = [
    taak(
      "schouw_week",
      schouwWeek
        ? `2.1 Schouwweek gezet - W${schouwWeek.week} · ${schouwWeek.jaar}`
        : "2.1 Schouwweek gezet",
      !cancelled && schouwWeekGezet,
      null,
      null
    ),
    taak(
      "schouw_datum",
      withPlanMoment(
        "2.2 Schouwdatum gepland",
        schouwDefinitief ? ctx.schouwAt : null
      ),
      !cancelled &&
        (schouwDefinitief ||
          reached(st, "schouwdag_ingepland") ||
          reached(st, "schouw_voltooid")),
      // Datum staat al in het label — niet nog eens bij “Afgerond”
      null,
      null
    ),
    taak(
      "schouw_done",
      "2.3 Schouw uitgevoerd",
      !cancelled && ctx.schouwFormulierGeupload,
      ctx.schouwFormulierAt,
      ctx.schouwFormulierGeupload ? "Schouwformulier geüpload" : null
    ),
  ];

  const f3Taken: NettoFaseTaak[] = [
    taak(
      "materiaal",
      "3.1 Materiaal besteld",
      !cancelled && reached(st, "materiaal_besteld")
    ),
    taak(
      "installatie_plan",
      withPlanMoment("3.2 Installatie inplannen", ctx.installatieAt),
      !cancelled &&
        (installatieGepland ||
          reached(st, "installatie_ingepland") ||
          reached(st, "installatie_voltooid")),
      null,
      null
    ),
    taak(
      "installatie_done",
      "3.3 Installatie uitgevoerd",
      !cancelled && reached(st, "installatie_voltooid"),
      ctx.installatieVoltooidAt ||
        (reached(st, "installatie_voltooid") ? ctx.installatieAt : null),
      null
    ),
  ];

  const f4Taken: NettoFaseTaak[] = [
    taak(
      "btw_terugvragen",
      "4.1 BTW terugvragen aangevraagd",
      !cancelled && Boolean(ctx.btwTerugvragenAt),
      ctx.btwTerugvragenAt || null
    ),
    taak(
      "overstap_leverancier",
      "4.2 Overstap dynamische leverancier",
      !cancelled && Boolean(ctx.overstapDynamischeLeverancierAt),
      ctx.overstapDynamischeLeverancierAt || null
    ),
    taak(
      "review",
      "4.3 Review",
      !cancelled &&
        (Boolean(ctx.reviewGevraagdAt) ||
          reached(st, "review_gevraagd") ||
          reached(st, "afgerond") ||
          normalizeProjectStatus(st) === "service"),
      ctx.reviewGevraagdAt || null
    ),
  ];

  function wrap(
    key: NettoFaseKey,
    label: string,
    applicable: boolean,
    taken: NettoFaseTaak[]
  ): NettoFase {
    if (!applicable) {
      return { key, label, applicable: false, taken: [], done: 0, total: 0 };
    }
    const done = taken.filter((t) => t.done).length;
    return {
      key,
      label,
      applicable: true,
      taken,
      done,
      total: taken.length,
    };
  }

  return [
    wrap("f1", ctx.vorm === "WF" ? "Financiering" : "Aanbetaling", true, f1Taken),
    wrap("f2", "Schouw", true, f2Taken),
    wrap("f3", "Installatie", true, f3Taken),
    wrap("f4", "Afronding", true, f4Taken),
  ];
}

export function summarizeFases(fases: NettoFase[]): {
  done: number;
  total: number;
  pct: number;
  allDone: boolean;
} {
  let done = 0;
  let total = 0;
  for (const f of fases) {
    if (!f.applicable) continue;
    done += f.done;
    total += f.total;
  }
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, pct, allDone: total > 0 && done === total };
}

/**
 * Netto sale = installatie uitgevoerd (fase 3.3).
 * Afronding (BTW / overstap / review) mag open blijven.
 */
export function boardStatusOf(opts: {
  geannuleerd: boolean;
  fases: NettoFase[];
}): NettoBoardStatus {
  if (opts.geannuleerd) return "geannuleerd";
  const f3 = opts.fases.find((f) => f.key === "f3");
  const installatieUitgevoerd = Boolean(
    f3?.taken.some((t) => t.id === "installatie_done" && t.done)
  );
  if (installatieUitgevoerd) return "netto";
  return "actief";
}

/** Order geannuleerd in CRM → niet meetellen in Netto (actief/netto). */
export function isNettoGeannuleerd(opts: {
  projectStatus?: string | null;
  offerteStatus?: string | null;
}): boolean {
  if (opts.offerteStatus === "afgewezen") return true;
  const raw = (opts.projectStatus || "").trim().toLowerCase();
  if (raw === "annulering" || raw === "geannuleerd") return true;
  return normalizeProjectStatus(opts.projectStatus) === "annulering";
}

export const NETTO_ANNULERING_LABEL = "Annulering door klant";

export function isAanbetalingFactuur(omschrijving: string | null | undefined) {
  return isAanbetalingFactuurOmschrijving(omschrijving);
}

export { buildNettoFases as buildFases };
export type { BuildCtx as NettoBuildCtx };

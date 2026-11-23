/**
 * Centrale bron voor projectstatussen + gekoppelde auto-taken.
 * Statuskeys: NL snake_case. UI-labels elders in labels.ts.
 */
import type { ProjectAfdeling } from "@/lib/project-afdeling";

export type Betaalwijze = "warmtefonds" | "eigen_middelen";

export type ProjectStatusFase =
  | "voorbereiding"
  | "financiering"
  | "schouw"
  | "eindafrekening"
  | "uitvoering"
  | "afronding"
  | "nazorg"
  | "overig";

export const PROJECT_STATUS_FASE_LABEL: Record<ProjectStatusFase, string> = {
  voorbereiding: "Opstarten",
  financiering: "Financiering",
  schouw: "Schouw",
  /** WF: declaratie ná goedkeuring, vóór schouw. EM: restfactuur ná schouw. */
  eindafrekening: "WF declaratie",
  uitvoering: "Installatie",
  afronding: "Afronding",
  nazorg: "Nazorg",
  overig: "Annuleringen",
};

/** Fase-label per betaalwijze (EM noemt eindafrekening geen WF-declaratie). */
export function faseLabelFor(
  fase: ProjectStatusFase,
  betaalwijze?: Betaalwijze | null
): string {
  if (fase === "eindafrekening" && betaalwijze === "eigen_middelen") {
    return "Restfactuur";
  }
  return PROJECT_STATUS_FASE_LABEL[fase];
}

/** Kanban Overzicht (gemengd): WF-declaratie vóór schouw. */
export const PROJECT_STATUS_FASE_ORDER: ProjectStatusFase[] = [
  "voorbereiding",
  "financiering",
  "eindafrekening",
  "schouw",
  "uitvoering",
  "afronding",
  "nazorg",
  "overig",
];

/**
 * Fasevolgorde per betaalwijze.
 * EM: Opstarten → Schouw → Restfactuur (slaat financiering/WF-declaratie-positie over).
 * WF: Opstarten → Financiering → WF-declaratie → Schouw → …
 */
export function faseOrderFor(
  betaalwijze?: Betaalwijze | null
): ProjectStatusFase[] {
  if (betaalwijze === "eigen_middelen") {
    return [
      "voorbereiding",
      "schouw",
      "eindafrekening",
      "uitvoering",
      "afronding",
      "nazorg",
      "overig",
    ];
  }
  return PROJECT_STATUS_FASE_ORDER;
}

export type ProjectStatusKey =
  | "schouwweek_inplannen"
  | "aanbetaling_verstuurd"
  | "aanbetaling_betaald"
  | "warmtefonds_afspraak_ingepland"
  | "warmtefonds_aangevraagd"
  | "warmtefonds_in_behandeling"
  | "warmtefonds_afgewezen"
  | "warmtefonds_goedgekeurd"
  | "opstarten_voltooid_afwachten_wf"
  /** WF ná goedkeuring (aanbod ondertekenen): exacte schouwdag inplannen. */
  | "schouw_inplannen"
  | "schouwdag_ingepland"
  | "schouw_voltooid"
  | "restfactuur_verstuurd"
  | "restfactuur_betaald"
  | "materiaal_besteld"
  | "installatie_ingepland"
  | "installatie_voltooid"
  | "after_sale"
  | "review_gevraagd"
  | "afgerond"
  | "service"
  | "annulering"
  | "hold_sales_actie";

export type StatusBetaalwijzeScope = Betaalwijze | "beide";

export type DueRule =
  | { kind: "days"; days: number }
  | { kind: "schouw_minus_days"; days: number }
  | { kind: "installatie_minus_days"; days: number }
  /** Eerstvolgende werkdag (ma–vr) 17:00 ná klaar-moment. */
  | { kind: "next_weekday" }
  | { kind: "none" };

export type StatusTaakConfig = {
  titel: string;
  afdeling: ProjectAfdeling;
  due: DueRule;
  /** Unieke suffix voor auto_key (= `${status}:${autoKeySuffix}`) */
  autoKeySuffix: string;
};

export type ProjectStatusDef = {
  key: ProjectStatusKey;
  label: string;
  fase: ProjectStatusFase;
  /** Voor welke betaalwijze deze status geldt */
  scope: StatusBetaalwijzeScope;
  /** Lineaire pipeline (excl. aftakkingen zoals afgewezen / service) */
  inPipeline: boolean;
  /** Vaste auto-taak; kan per betaalwijze verschillen */
  taak: StatusTaakConfig | null;
  /**
   * Override taak per betaalwijze. `null` = geen auto-taak voor die betaalwijze
   * (bv. restfactuur-opvolgen alleen bij eigen middelen).
   */
  taakPerBetaalwijze?: Partial<Record<Betaalwijze, StatusTaakConfig | null>>;
};

/**
 * Afdeling-mapping t.o.v. specificatie:
 * Financiering → Backoffice, Administratie → Backoffice, Marketing → Verkoop.
 */
export const PROJECT_STATUS_DEFS: ProjectStatusDef[] = [
  {
    key: "schouwweek_inplannen",
    /** Opstarten: WF parallel; EM sequentieel (factuur → betaling → schouwweek) */
    label: "Opstarten",
    fase: "voorbereiding",
    scope: "beide",
    inPipeline: true,
    /** Taken via kickoffAutoTaken() — WF parallel, EM gestaffeld */
    taak: null,
  },
  {
    key: "aanbetaling_verstuurd",
    label: "Aanbetaling verstuurd",
    fase: "voorbereiding",
    scope: "beide",
    /** Legacy: geen aparte status meer — zit in kickoff-checklist */
    inPipeline: false,
    taak: null,
  },
  {
    key: "aanbetaling_betaald",
    label: "Aanbetaling betaald",
    fase: "voorbereiding",
    scope: "beide",
    /** Legacy: betaling volgt uit factuurstatus, niet uit orderstatus */
    inPipeline: false,
    taak: null,
  },
  {
    key: "warmtefonds_afspraak_ingepland",
    label: "Warmtefonds afspraak ingepland",
    fase: "financiering",
    scope: "warmtefonds",
    /** Niet in hoofdpad — parallel via financiering_status */
    inPipeline: false,
    taak: null,
  },
  {
    key: "warmtefonds_aangevraagd",
    label: "Warmtefonds aangevraagd",
    fase: "financiering",
    scope: "warmtefonds",
    inPipeline: false,
    taak: null,
  },
  {
    key: "warmtefonds_in_behandeling",
    label: "Warmtefonds in behandeling",
    fase: "financiering",
    scope: "warmtefonds",
    inPipeline: false,
    taak: null,
  },
  {
    key: "warmtefonds_afgewezen",
    label: "Warmtefonds afgewezen",
    fase: "financiering",
    scope: "warmtefonds",
    inPipeline: false,
    taak: null,
  },
  {
    key: "warmtefonds_goedgekeurd",
    label: "Warmtefonds goedgekeurd",
    fase: "financiering",
    scope: "warmtefonds",
    inPipeline: false,
    taak: null,
  },
  {
    key: "opstarten_voltooid_afwachten_wf",
    /** WF na kickoff: schouwweek staat, nog geen echte schouwdag — wachten op WF */
    label: "Opstarten voltooid — afwachten WF",
    fase: "voorbereiding",
    scope: "warmtefonds",
    inPipeline: true,
    taak: null,
  },
  {
    key: "schouw_inplannen",
    label: "Schouw inplannen",
    fase: "schouw",
    scope: "warmtefonds",
    inPipeline: true,
    /** Actie via openSchouwInplannenActies + sync-auto-taken, geen tweede auto-taak. */
    taak: null,
  },
  {
    key: "schouwdag_ingepland",
    /** Alleen exacte schouwdag (niet week-placeholder). Geen herinner-actie. */
    label: "Schouw gepland",
    fase: "schouw",
    scope: "beide",
    inPipeline: true,
    taak: null,
  },
  {
    key: "schouw_voltooid",
    label: "Schouw voltooid",
    fase: "schouw",
    scope: "beide",
    inPipeline: true,
    taak: {
      autoKeySuffix: "restfactuur",
      titel: "Restfactuur opstellen en versturen (totaal min aanbetaling)",
      afdeling: "Facturatie",
      due: { kind: "days", days: 1 },
    },
    /**
     * Warmtefonds: géén “betaling controleren”-actie.
     * Wachten tot WF betaald + schouwformulier → status restfactuur_betaald
     * → dan pas “Installatiedatum inplannen”.
     */
    taakPerBetaalwijze: {
      warmtefonds: null,
    },
  },
  {
    key: "restfactuur_verstuurd",
    /** EM: Restfactuur · WF: WF-declaratie (vóór/rond schouw) — labels.ts */
    label: "Restfactuur verstuurd",
    fase: "eindafrekening",
    scope: "beide",
    inPipeline: true,
    /**
     * Warmtefonds-restant: lange betaaltermijn (WF), geen korte opvolg-actie.
     * Alleen aanbetalingsfacturen krijgen na verlopen (3 d) nabellen/opvolging.
     * Eigen middelen: wel restfactuur-opvolgen.
     */
    taak: {
      autoKeySuffix: "opvolgen",
      titel: "Betaling restfactuur opvolgen",
      afdeling: "Facturatie",
      due: { kind: "days", days: 5 },
    },
    taakPerBetaalwijze: {
      warmtefonds: null,
    },
  },
  {
    key: "restfactuur_betaald",
    label: "Restfactuur betaald — installatie plannen",
    // WF-weergave: "Declaratie WF betaald - installatie inplannen" (labels.ts)
    // Fase uitvoering: dit is de brug naar installatie plannen, niet “eindafrekening”.
    fase: "uitvoering",
    scope: "beide",
    inPipeline: true,
    /**
     * WF: schouw geweest + declaratie betaald → installatie inplannen
     * op de eerstvolgende werkdag. Daarna, zodra de installatie gepland is,
     * Purchasing “te bestellen” met besteldatum 5 werkdagen vóór installatie.
     */
    taak: {
      autoKeySuffix: "installatie",
      titel: "Installatiedatum inplannen",
      afdeling: "Planning",
      due: { kind: "next_weekday" },
    },
  },
  {
    key: "materiaal_besteld",
    label: "Materiaal ingekocht — wachten op levering",
    fase: "uitvoering",
    scope: "beide",
    inPipeline: true,
    /**
     * Als installatie nog niet gezet is (legacy), plan die nu.
     * Met installatie_at is er geen aparte bevestig-actie meer.
     */
    taak: {
      autoKeySuffix: "installatie",
      titel: "Installatiedatum inplannen",
      afdeling: "Planning",
      due: { kind: "next_weekday" },
    },
  },
  {
    key: "installatie_ingepland",
    label: "Installatie ingepland",
    fase: "uitvoering",
    scope: "beide",
    inPipeline: true,
    /** Geen actie: datum staat; monteur/klant-bevestiging is geen backoffice-stap. */
    taak: null,
  },
  {
    key: "installatie_voltooid",
    label: "Installatie voltooid",
    fase: "uitvoering",
    scope: "beide",
    inPipeline: true,
    /** Opleverformulier gezet → after_sale (overstap + BTW + review). */
    taak: null,
  },
  {
    key: "after_sale",
    label: "After sale",
    fase: "afronding",
    scope: "beide",
    inPipeline: true,
    /** Overstap dynamische leverancier, BTW-terugvrage, review. */
    taak: null,
  },
  {
    key: "review_gevraagd",
    label: "After sale",
    fase: "afronding",
    scope: "beide",
    /** Legacy alias van after_sale. */
    inPipeline: false,
    taak: null,
  },
  {
    key: "afgerond",
    label: "Afgerond",
    fase: "afronding",
    scope: "beide",
    inPipeline: true,
    /** Referrals via autoTakenVoorStatus. */
    taak: null,
  },
  {
    key: "service",
    label: "Service",
    fase: "nazorg",
    scope: "beide",
    inPipeline: false,
    taak: null,
  },
  {
    key: "annulering",
    label: "Annulering",
    fase: "overig",
    scope: "beide",
    inPipeline: false,
    /** Geen vaste taak: bij verzonden factuur maakt sync-auto-taken
     *  conditioneel "Creditfactuur maken" aan. */
    taak: null,
  },
  {
    key: "hold_sales_actie",
    label: "HOLD SALES ACTIE",
    fase: "overig",
    scope: "beide",
    inPipeline: false,
    taak: null,
  },
];

export const PROJECT_STATUS_KEYS = PROJECT_STATUS_DEFS.map((d) => d.key);

export const PROJECT_STATUS_BY_KEY: Record<
  ProjectStatusKey,
  ProjectStatusDef
> = Object.fromEntries(
  PROJECT_STATUS_DEFS.map((d) => [d.key, d])
) as Record<ProjectStatusKey, ProjectStatusDef>;

export function isProjectStatusKey(
  value: string | null | undefined
): value is ProjectStatusKey {
  return Boolean(
    value && (PROJECT_STATUS_KEYS as readonly string[]).includes(value)
  );
}

export function statusAppliesToBetaalwijze(
  def: ProjectStatusDef,
  betaalwijze: Betaalwijze
): boolean {
  return def.scope === "beide" || def.scope === betaalwijze;
}

/**
 * Lineaire pipeline per betaalwijze (zonder afgewezen/service/financiering-track).
 *
 * WF: Opstarten → afwachten WF → WF-declaratie → Schouw → installatie…
 * EM: Opstarten (afwachten aanbetaling) → Schouw → Restfactuur → installatie…
 *     (slaat WF/financiering/declaratie-fase over)
 */
export function projectPipelineFor(
  betaalwijze: Betaalwijze
): ProjectStatusKey[] {
  if (betaalwijze === "eigen_middelen") {
    return [
      "schouwweek_inplannen",
      "schouwdag_ingepland",
      "schouw_voltooid",
      "restfactuur_verstuurd",
      "restfactuur_betaald",
      "materiaal_besteld",
      "installatie_ingepland",
      "installatie_voltooid",
      "after_sale",
      "afgerond",
    ];
  }

  return [
    "schouwweek_inplannen",
    "opstarten_voltooid_afwachten_wf",
    "schouw_inplannen",
    "restfactuur_verstuurd",
    "schouwdag_ingepland",
    "schouw_voltooid",
    "restfactuur_betaald",
    "materiaal_besteld",
    "installatie_ingepland",
    "installatie_voltooid",
    "after_sale",
    "afgerond",
  ];
}

/**
 * Selecteerbare hoofdstatussen — financiering loopt parallel via
 * financiering_status; aanbetaling via factuur + kickoff-checklist.
 */
export function projectStatusesFor(
  betaalwijze: Betaalwijze
): ProjectStatusKey[] {
  return PROJECT_STATUS_DEFS.filter(
    (d) =>
      d.fase !== "financiering" &&
      d.key !== "aanbetaling_verstuurd" &&
      d.key !== "aanbetaling_betaald" &&
      d.key !== "review_gevraagd" &&
      statusAppliesToBetaalwijze(d, betaalwijze)
  ).map((d) => d.key);
}

/**
 * Legacy / parallel-status → operationele orderstatus.
 * Aanbetaling + Warmtefonds zitten niet in het orderpad.
 */
export function toOperationalStatus(
  status: string | null | undefined
): ProjectStatusKey {
  const key = remapLegacyProjectStatus(status);
  switch (key) {
    case "aanbetaling_verstuurd":
    case "aanbetaling_betaald":
    case "warmtefonds_afspraak_ingepland":
    case "warmtefonds_aangevraagd":
    case "warmtefonds_in_behandeling":
    case "warmtefonds_afgewezen":
      return "schouwweek_inplannen";
    case "warmtefonds_goedgekeurd":
      return "schouw_inplannen";
    default:
      return key;
  }
}

export function resolveStatusTaak(
  status: ProjectStatusKey,
  betaalwijze: Betaalwijze
): StatusTaakConfig | null {
  const def = PROJECT_STATUS_BY_KEY[status];
  if (!def) return null;
  if (
    def.taakPerBetaalwijze &&
    Object.prototype.hasOwnProperty.call(def.taakPerBetaalwijze, betaalwijze)
  ) {
    return def.taakPerBetaalwijze[betaalwijze] ?? null;
  }
  return def.taak;
}

export function resolveBetaalwijze(opts: {
  betaalwijze?: string | null;
  leadStatus?: string | null;
  financieringVoorbehoud?: boolean | null;
}): Betaalwijze {
  // Lead-sale-status wint (kan later wijzigen van WF ↔ EM)
  if (opts.leadStatus === "sale_eigen_middelen") return "eigen_middelen";
  if (opts.leadStatus === "sale_financiering") return "warmtefonds";
  if (opts.betaalwijze === "warmtefonds" || opts.betaalwijze === "eigen_middelen") {
    return opts.betaalwijze;
  }
  if (opts.financieringVoorbehoud === false) return "eigen_middelen";
  if (opts.financieringVoorbehoud === true) return "warmtefonds";
  return "warmtefonds";
}

/** Oude / legacy status → dichtstbijzijnde nieuwe status. */
export function remapLegacyProjectStatus(
  status: string | null | undefined
): ProjectStatusKey {
  switch (status) {
    case "schouwweek_inplannen":
    case "aanbetaling_verstuurd":
    case "aanbetaling_betaald":
    case "warmtefonds_afspraak_ingepland":
    case "warmtefonds_aangevraagd":
    case "warmtefonds_in_behandeling":
    case "warmtefonds_afgewezen":
    case "warmtefonds_goedgekeurd":
    case "opstarten_voltooid_afwachten_wf":
    case "schouw_inplannen":
    case "schouwdag_ingepland":
    case "schouw_voltooid":
    case "restfactuur_verstuurd":
    case "restfactuur_betaald":
    case "materiaal_besteld":
    case "installatie_ingepland":
    case "installatie_voltooid":
    case "after_sale":
    case "afgerond":
    case "service":
    case "annulering":
    case "hold_sales_actie":
      return status;

    // Huidige pipeline (vóór deze migratie)
    case "schouw_aanbetaling":
      return "schouwweek_inplannen";
    case "schouwweek_gepland":
      return "aanbetaling_verstuurd";
    case "schouwdag_plannen":
      return "aanbetaling_betaald";
    case "schouw_in_afwachting":
    case "schouw_gepland":
      return "schouwdag_ingepland";
    case "materiaal_installatie":
    case "materiaal_inkopen":
    case "product_ingekocht":
      return "materiaal_besteld";
    case "installatie_gepland":
      return "installatie_ingepland";
    case "btw_factuur_eruit":
      return "restfactuur_verstuurd";
    case "review_gevraagd":
      return "after_sale";

    default:
      return "schouwweek_inplannen";
  }
}

export const BETAALWIJZE_LABEL: Record<Betaalwijze, string> = {
  warmtefonds: "Warmtefonds",
  eigen_middelen: "Eigen middelen",
};

/**
 * Status na schouwweek/-dag inplannen.
 * "Schouw gepland" alleen bij exacte schouwdag; week-placeholder → WF wachtstatus of Opstarten (EM).
 */
export function statusNaSchouwInplannen(opts: {
  exacteDag: boolean;
  /** @deprecated Week-only blijft altijd in Opstarten; WF-voltooid via kickoff-complete. */
  warmtefonds?: boolean;
  /** Huidige orderstatus — week-only mag niet terugvallen naar Opstarten. */
  currentStatus?: string | null;
}): ProjectStatusKey {
  if (opts.exacteDag) return "schouwdag_ingepland";
  const current = toOperationalStatus(opts.currentStatus);
  if (
    current === "schouw_inplannen" ||
    current === "opstarten_voltooid_afwachten_wf"
  ) {
    return current;
  }
  // Alleen week: blijf in Opstarten — aanbetaling / Edwin kunnen nog open.
  return "schouwweek_inplannen";
}

/**
 * Status na installatiedatum (her)zetten.
 * Gaat nooit terug: voltooid / after sale / afgerond blijven staan.
 */
export function statusNaInstallatieInplannen(opts: {
  currentStatus?: string | null;
  betaalwijze?: string | null;
}): ProjectStatusKey {
  const current = toOperationalStatus(opts.currentStatus);
  if (
    current === "annulering" ||
    current === "hold_sales_actie" ||
    current === "service"
  ) {
    return current;
  }
  const bw = resolveBetaalwijze({ betaalwijze: opts.betaalwijze });
  const pipeline = projectPipelineFor(bw);
  const ci = pipeline.indexOf(current);
  const ti = pipeline.indexOf("installatie_ingepland");
  if (ci >= 0 && ti >= 0 && ci >= ti) return current;
  return "installatie_ingepland";
}

/**
 * WF-goedkeuring (aanbod ondertekenen+): orderstatus → Schouw inplannen,
 * tenzij er al een exacte schouwdag is of de order verder is.
 */
export function orderStatusNaWfGoedkeuring(opts: {
  currentStatus: string | null | undefined;
  exacteSchouwdag: boolean;
}): ProjectStatusKey | null {
  if (opts.exacteSchouwdag) return null;
  const op = toOperationalStatus(opts.currentStatus);
  if (
    op === "schouwweek_inplannen" ||
    op === "opstarten_voltooid_afwachten_wf" ||
    op === "schouw_inplannen"
  ) {
    return "schouw_inplannen";
  }
  return null;
}

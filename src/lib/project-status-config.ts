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
  voorbereiding: "Voorbereiding",
  financiering: "Financiering",
  schouw: "Schouw",
  eindafrekening: "Eindafrekening",
  uitvoering: "Uitvoering",
  afronding: "Afronding",
  nazorg: "Nazorg",
  overig: "Overig",
};

export type ProjectStatusKey =
  | "schouwweek_inplannen"
  | "aanbetaling_verstuurd"
  | "aanbetaling_betaald"
  | "warmtefonds_afspraak_ingepland"
  | "warmtefonds_aangevraagd"
  | "warmtefonds_in_behandeling"
  | "warmtefonds_afgewezen"
  | "warmtefonds_goedgekeurd"
  | "schouwdag_ingepland"
  | "schouw_voltooid"
  | "restfactuur_verstuurd"
  | "restfactuur_betaald"
  | "materiaal_besteld"
  | "installatie_ingepland"
  | "installatie_voltooid"
  | "review_gevraagd"
  | "service"
  | "annulering"
  | "hold_sales_actie";

export type StatusBetaalwijzeScope = Betaalwijze | "beide";

export type DueRule =
  | { kind: "days"; days: number }
  | { kind: "schouw_minus_days"; days: number }
  | { kind: "installatie_minus_days"; days: number }
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
  /** Override taak per betaalwijze (bv. aanbetaling_betaald) */
  taakPerBetaalwijze?: Partial<Record<Betaalwijze, StatusTaakConfig>>;
};

/**
 * Afdeling-mapping t.o.v. specificatie:
 * Financiering → Backoffice, Administratie → Backoffice, Marketing → Verkoop.
 */
export const PROJECT_STATUS_DEFS: ProjectStatusDef[] = [
  {
    key: "schouwweek_inplannen",
    label: "Schouwweek inplannen",
    fase: "voorbereiding",
    scope: "beide",
    inPipeline: true,
    taak: {
      autoKeySuffix: "bellen",
      titel:
        "Klant bellen: schouwweek inplannen (±5 wkn vooruit bij warmtefonds) en aanbetalingsfactuur versturen (modus zoals ingesteld op project)",
      afdeling: "Planning",
      due: { kind: "days", days: 1 },
    },
  },
  {
    key: "aanbetaling_verstuurd",
    label: "Aanbetaling verstuurd",
    fase: "voorbereiding",
    scope: "beide",
    inPipeline: true,
    taak: {
      autoKeySuffix: "opvolgen",
      titel: "Betaling aanbetaling opvolgen",
      afdeling: "Facturatie",
      due: { kind: "days", days: 5 },
    },
  },
  {
    key: "aanbetaling_betaald",
    label: "Aanbetaling betaald",
    fase: "voorbereiding",
    scope: "beide",
    inPipeline: true,
    taak: null,
    taakPerBetaalwijze: {
      warmtefonds: {
        autoKeySuffix: "wf_aanvraag",
        titel: "Warmtefonds-aanvraagafspraak inplannen",
        afdeling: "Backoffice",
        due: { kind: "days", days: 2 },
      },
      eigen_middelen: {
        autoKeySuffix: "schouwdag",
        titel: "Schouwdag direct inplannen (geen warmtefonds-wachttijd)",
        afdeling: "Planning",
        due: { kind: "days", days: 2 },
      },
    },
  },
  {
    key: "warmtefonds_afspraak_ingepland",
    label: "Warmtefonds afspraak ingepland",
    fase: "financiering",
    scope: "warmtefonds",
    inPipeline: true,
    taak: {
      autoKeySuffix: "aanvraag",
      titel: "Warmtefonds-aanvraag indienen tijdens/na afspraak",
      afdeling: "Backoffice",
      due: { kind: "days", days: 1 },
    },
  },
  {
    key: "warmtefonds_aangevraagd",
    label: "Warmtefonds aangevraagd",
    fase: "financiering",
    scope: "warmtefonds",
    inPipeline: true,
    taak: {
      autoKeySuffix: "opvolgen",
      titel: "Opvolgen bij Warmtefonds",
      afdeling: "Backoffice",
      due: { kind: "days", days: 3 },
    },
  },
  {
    key: "warmtefonds_in_behandeling",
    label: "Warmtefonds in behandeling",
    fase: "financiering",
    scope: "warmtefonds",
    inPipeline: true,
    taak: {
      autoKeySuffix: "opvolgen",
      titel: "Opvolgen Warmtefonds-status",
      afdeling: "Backoffice",
      due: { kind: "days", days: 5 },
    },
  },
  {
    key: "warmtefonds_afgewezen",
    label: "Warmtefonds afgewezen",
    fase: "financiering",
    scope: "warmtefonds",
    inPipeline: false,
    taak: {
      autoKeySuffix: "schakel",
      titel:
        "Schakel financiering: zet om naar eigen middelen of stop project, overleg met klant",
      afdeling: "Backoffice",
      due: { kind: "days", days: 1 },
    },
  },
  {
    key: "warmtefonds_goedgekeurd",
    label: "Warmtefonds goedgekeurd",
    fase: "financiering",
    scope: "warmtefonds",
    inPipeline: true,
    taak: {
      autoKeySuffix: "schouwdag",
      titel: "Klant bellen: definitieve schouwdag inplannen",
      afdeling: "Planning",
      due: { kind: "days", days: 2 },
    },
  },
  {
    key: "schouwdag_ingepland",
    label: "Schouwdag ingepland",
    fase: "schouw",
    scope: "beide",
    inPipeline: true,
    taak: {
      autoKeySuffix: "herinneren",
      titel: "Schouwdag bevestigen/herinneren richting datum",
      afdeling: "Planning",
      due: { kind: "schouw_minus_days", days: 2 },
    },
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
  },
  {
    key: "restfactuur_verstuurd",
    label: "Restfactuur verstuurd",
    fase: "eindafrekening",
    scope: "beide",
    inPipeline: true,
    taak: {
      autoKeySuffix: "opvolgen",
      titel: "Betaling restfactuur opvolgen",
      afdeling: "Facturatie",
      due: { kind: "days", days: 5 },
    },
  },
  {
    key: "restfactuur_betaald",
    label: "Restfactuur betaald",
    fase: "eindafrekening",
    scope: "beide",
    inPipeline: true,
    taak: {
      autoKeySuffix: "materiaal",
      titel: "Materiaal bestellen",
      afdeling: "Installatie",
      due: { kind: "days", days: 2 },
    },
  },
  {
    key: "materiaal_besteld",
    label: "Materiaal ingekocht — wachten op levering",
    fase: "uitvoering",
    scope: "beide",
    inPipeline: true,
    taak: {
      autoKeySuffix: "installatie",
      titel: "Installatiedatum inplannen",
      afdeling: "Planning",
      due: { kind: "none" },
    },
  },
  {
    key: "installatie_ingepland",
    label: "Installatie ingepland",
    fase: "uitvoering",
    scope: "beide",
    inPipeline: true,
    taak: {
      autoKeySuffix: "bevestigen",
      titel: "Bevestigen met klant + monteur inplannen",
      afdeling: "Planning",
      due: { kind: "installatie_minus_days", days: 3 },
    },
  },
  {
    key: "installatie_voltooid",
    label: "Installatie voltooid",
    fase: "afronding",
    scope: "beide",
    inPipeline: true,
    taak: {
      autoKeySuffix: "frank_btw",
      titel:
        "Overstap Frank Energie aanvragen + BTW-teruggave indienen (eenmalig, direct uitvoeren)",
      afdeling: "Backoffice",
      due: { kind: "days", days: 2 },
    },
  },
  {
    key: "review_gevraagd",
    label: "Review gevraagd",
    fase: "afronding",
    scope: "beide",
    inPipeline: true,
    taak: {
      autoKeySuffix: "review",
      titel: "Review-verzoek versturen",
      afdeling: "Verkoop",
      due: { kind: "days", days: 1 },
    },
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
    label: "HOLD - Sales actie",
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

/** Lineaire pipeline voor een betaalwijze (zonder afgewezen/service). */
export function projectPipelineFor(
  betaalwijze: Betaalwijze
): ProjectStatusKey[] {
  return PROJECT_STATUS_DEFS.filter(
    (d) => d.inPipeline && statusAppliesToBetaalwijze(d, betaalwijze)
  ).map((d) => d.key);
}

/** Alle selecteerbare statussen voor een betaalwijze (incl. aftakkingen). */
export function projectStatusesFor(
  betaalwijze: Betaalwijze
): ProjectStatusKey[] {
  return PROJECT_STATUS_DEFS.filter((d) =>
    statusAppliesToBetaalwijze(d, betaalwijze)
  ).map((d) => d.key);
}

export function resolveStatusTaak(
  status: ProjectStatusKey,
  betaalwijze: Betaalwijze
): StatusTaakConfig | null {
  const def = PROJECT_STATUS_BY_KEY[status];
  if (!def) return null;
  return def.taakPerBetaalwijze?.[betaalwijze] ?? def.taak;
}

export function resolveBetaalwijze(opts: {
  betaalwijze?: string | null;
  leadStatus?: string | null;
  financieringVoorbehoud?: boolean | null;
}): Betaalwijze {
  if (opts.betaalwijze === "warmtefonds" || opts.betaalwijze === "eigen_middelen") {
    return opts.betaalwijze;
  }
  if (opts.leadStatus === "sale_eigen_middelen") return "eigen_middelen";
  if (opts.leadStatus === "sale_financiering") return "warmtefonds";
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
    case "schouwdag_ingepland":
    case "schouw_voltooid":
    case "restfactuur_verstuurd":
    case "restfactuur_betaald":
    case "materiaal_besteld":
    case "installatie_ingepland":
    case "installatie_voltooid":
    case "review_gevraagd":
    case "service":
    case "annulering":
    case "hold_sales_actie":
      return status;

    // Huidige pipeline (vóór deze migratie)
    case "schouw_aanbetaling":
    case "schouw_inplannen":
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

    default:
      return "schouwweek_inplannen";
  }
}

export const BETAALWIJZE_LABEL: Record<Betaalwijze, string> = {
  warmtefonds: "Warmtefonds",
  eigen_middelen: "Eigen middelen",
};

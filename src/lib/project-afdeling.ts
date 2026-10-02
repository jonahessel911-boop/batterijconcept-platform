/** Vaste afdelingen voor backoffice-projecten / taken. */
export const PROJECT_AFDELINGEN = [
  "Backoffice",
  "Planning",
  "Installatie",
  "Facturatie",
  "Verkoop",
] as const;

export type ProjectAfdeling = (typeof PROJECT_AFDELINGEN)[number];

export function isProjectAfdeling(
  value: string | null | undefined
): value is ProjectAfdeling {
  return Boolean(
    value && (PROJECT_AFDELINGEN as readonly string[]).includes(value)
  );
}

/** Standaard-afdeling bij een pipeline-status. */
export function defaultAfdelingVoorStatus(status: string): ProjectAfdeling {
  switch (status) {
    case "schouwweek_inplannen":
    case "schouwdag_ingepland":
    case "warmtefonds_goedgekeurd":
    case "materiaal_besteld":
    case "installatie_ingepland":
    case "schouw_aanbetaling":
    case "schouw_in_afwachting":
      return "Planning";
    case "aanbetaling_verstuurd":
    case "schouw_voltooid":
    case "restfactuur_verstuurd":
    case "restfactuur_betaald":
      return "Facturatie";
    case "materiaal_installatie":
      return "Installatie";
    case "review_gevraagd":
      return "Verkoop";
    case "aanbetaling_betaald":
    case "warmtefonds_afspraak_ingepland":
    case "warmtefonds_aangevraagd":
    case "warmtefonds_in_behandeling":
    case "warmtefonds_afgewezen":
    case "installatie_voltooid":
    case "service":
    default:
      return "Backoffice";
  }
}

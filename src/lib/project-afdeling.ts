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
    case "schouw_aanbetaling":
    case "aanbetaling_betaald":
    case "schouw_in_afwachting":
    case "schouw_voltooid":
      return "Planning";
    case "restfactuur_verstuurd":
    case "restfactuur_betaald":
      return "Facturatie";
    case "materiaal_installatie":
    case "installatie_voltooid":
      return "Installatie";
    case "service":
      return "Backoffice";
    default:
      return "Backoffice";
  }
}

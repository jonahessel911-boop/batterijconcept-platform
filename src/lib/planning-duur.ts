/** Vaste duur op het planbord / installateursagenda. */
export const SCHOUW_DUUR_MINUTEN = 30;
/** Middag-installatie 13–17 (fallback als venster onbekend). */
export const INSTALLATIE_DUUR_MINUTEN = 240;
/** Ochtend-installatie 09–12 */
export const INSTALLATIE_OCHTEND_DUUR_MINUTEN = 180;
/** Middag-installatie 13–17 */
export const INSTALLATIE_MIDDAG_DUUR_MINUTEN = 240;
export const SERVICE_DUUR_MINUTEN = 60; // 1 uur
export const LEVERING_DUUR_MINUTEN = 60; // 1 uur (ochtend-slot)

export function installatieDuurVoorVenster(
  venster: "ochtend" | "middag" | null | undefined
): number {
  if (venster === "ochtend") return INSTALLATIE_OCHTEND_DUUR_MINUTEN;
  return INSTALLATIE_MIDDAG_DUUR_MINUTEN;
}

export function duurMinutenVoorKind(
  kind: "schouw" | "schouwweek" | "installatie" | "service" | "levering"
): number {
  if (kind === "installatie") return INSTALLATIE_DUUR_MINUTEN;
  if (kind === "service") return SERVICE_DUUR_MINUTEN;
  if (kind === "levering") return LEVERING_DUUR_MINUTEN;
  if (kind === "schouw") return SCHOUW_DUUR_MINUTEN;
  return 0;
}

export function formatDuurLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return h === 1 ? "1 uur" : `${h} uur`;
  return `${h}u${String(m).padStart(2, "0")}`;
}

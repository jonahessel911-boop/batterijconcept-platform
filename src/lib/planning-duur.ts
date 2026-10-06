/** Vaste duur op het planbord / installateursagenda. */
export const SCHOUW_DUUR_MINUTEN = 30;
export const INSTALLATIE_DUUR_MINUTEN = 180; // 3 uur
export const SERVICE_DUUR_MINUTEN = 60; // 1 uur

export function duurMinutenVoorKind(
  kind: "schouw" | "schouwweek" | "installatie" | "service"
): number {
  if (kind === "installatie") return INSTALLATIE_DUUR_MINUTEN;
  if (kind === "service") return SERVICE_DUUR_MINUTEN;
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

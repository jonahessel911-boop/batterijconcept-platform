/**
 * Algemene Voorwaarden BatterijConcept v4 — Artikel 4A.
 * Annuleringskosten na Definitieve Financieringsgoedkeuring.
 */
export const AV_ANNULERING_ARTIKEL =
  process.env.AV_ANNULERING_ARTIKEL?.trim() || "4A";

/** 20% van het totale orderbedrag (inc. btw). */
export const AV_ANNULERING_PCT = 0.2;

export function annuleringskostenIncBtw(totaalIncBtw: number): number {
  const totaal = Number(totaalIncBtw);
  if (!Number.isFinite(totaal) || totaal <= 0) return 0;
  return Math.round(totaal * AV_ANNULERING_PCT * 100) / 100;
}

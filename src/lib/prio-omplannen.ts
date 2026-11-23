/** Vaste afboeking — niet vrije tekst. Filterbaar in SQL en KPI. */
export const PRIO_OMPLANNEN_CODE = "prio_omplannen" as const;
export const PRIO_OMPLANNEN_REDEN = "PRIO omplannen";

export type PrioOmplannenCode = typeof PRIO_OMPLANNEN_CODE;

export function isPrioOmplannenAfspraak(a: {
  annulering_code?: string | null;
} | null | undefined): boolean {
  return (a?.annulering_code || "") === PRIO_OMPLANNEN_CODE;
}

/** Nieuwe booking vanuit de PRIO-bak, of de geannuleerde bron. */
export function isPrioOmplannenCreditUitsluiten(a: {
  annulering_code?: string | null;
  herpland_van_afspraak_id?: string | null;
} | null | undefined): boolean {
  if (!a) return false;
  if (isPrioOmplannenAfspraak(a)) return true;
  return Boolean((a.herpland_van_afspraak_id || "").trim());
}

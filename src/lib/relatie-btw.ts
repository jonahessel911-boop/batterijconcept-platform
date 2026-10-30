/**
 * BTW-helpers voor selfbilling (adviseur/partner).
 * Geen Node/fs — veilig in client én server.
 */

/** NL BTW-tarief op selfbilling-facturen (commissie/vergoeding). */
export const RELATIE_BTW_PCT = 0.21;

/**
 * Selfbilling adviseur/partner → Batterijconcept.
 * Commissie/vergoeding is exclusief btw; hierop komt 21% btw (niet verlegd).
 */
export function bedragenMetBtw(exBtw: number): {
  bedrag_ex_btw: number;
  btw_bedrag: number;
  bedrag_inc_btw: number;
} {
  const bedrag_ex_btw = Math.round(exBtw * 100) / 100;
  const btw_bedrag = Math.round(bedrag_ex_btw * RELATIE_BTW_PCT * 100) / 100;
  const bedrag_inc_btw = Math.round((bedrag_ex_btw + btw_bedrag) * 100) / 100;
  return { bedrag_ex_btw, btw_bedrag, bedrag_inc_btw };
}

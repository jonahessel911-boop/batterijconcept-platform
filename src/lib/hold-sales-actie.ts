/** Actietitel zodra de hold-deadline (14 dagen na tekenen) voorbij is. */
export const HOLD_SALES_VERLOPEN_TITEL =
  "Annulering - hold sales actie verlopen";

/** Open taak in adviseur-account (Netto) zolang HOLD actief is. */
export const HOLD_SALES_ACTIE_TITEL = "HOLD SALES ACTIE";
export const HOLD_SALES_ACTIE_AUTO_KEY = "hold_sales_actie";

export function isHoldSalesVerlopenTaak(titel: string | null | undefined): boolean {
  return (titel || "").trim() === HOLD_SALES_VERLOPEN_TITEL;
}

export function isHoldSalesActieTaak(opts: {
  titel?: string | null;
  auto_key?: string | null;
}): boolean {
  if ((opts.auto_key || "").trim() === HOLD_SALES_ACTIE_AUTO_KEY) return true;
  return (opts.titel || "").trim() === HOLD_SALES_ACTIE_TITEL;
}

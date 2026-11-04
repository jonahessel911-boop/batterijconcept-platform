/** Edergy (Edwin Veenendaal) per Warmtefonds-aanvraag. Bedragen exact als zijn factuur. */
export const EDERGY_PER_AANVRAAG_INC = 375;
export const EDERGY_PER_AANVRAAG_EXCL = 296.25;
export const EDERGY_PER_AANVRAAG_BTW = 78.75;

/**
 * Vanaf deze dag telt €375 mee in de winst.
 * Eerdere aanvragen blijven buiten de P&L (zijn factuur 2026.1101 staat al buiten het systeem).
 */
export const EDERGY_VANAF_YMD = "2026-11-04";

/** Thuisadres voor de rit aan het eind van de dag. Zelfde adres als op zijn factuur. */
export const EDERGY_THUIS_ADRES = "Zuidwenk 100, 3751CG Bunschoten-Spakenburg";

import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

/** Standaard betaaltermijn na verzenden factuur. */
export const FACTUUR_BETAALTERMIJN_DAGEN = 3;

export const COMPANY_IBAN_DISPLAY = "NL48 BUNQ 2209 5579 33";
export const COMPANY_IBAN_COMPACT = "NL48BUNQ2209557933";
export const COMPANY_ACCOUNT_NAME = "BatterijConcept";

/** Vandaag (Amsterdam) + N dagen als YYYY-MM-DD. */
export function amsterdamDatePlusDays(
  from: Date | string,
  days: number
): string {
  const base = typeof from === "string" ? new Date(from) : from;
  const local = toZonedTime(base, AMSTERDAM_TZ);
  const next = addDays(local, days);
  return formatInTimeZone(next, AMSTERDAM_TZ, "yyyy-MM-dd");
}

/** Einde van vervaldag 23:59:59 Amsterdam. */
export function vervaldatumEndOfDay(vervaldatum: string): Date {
  const local = toZonedTime(new Date(`${vervaldatum}T12:00:00`), AMSTERDAM_TZ);
  local.setHours(23, 59, 59, 999);
  return fromZonedTime(local, AMSTERDAM_TZ);
}

export function factuurIsOpenstaand(status: string): boolean {
  return status === "verzonden" || status === "deels_betaald";
}

/** Verzonden + na vervaldatum + niet betaald → rood / nabellen. */
export function factuurIsOverdue(opts: {
  status: string;
  vervaldatum?: string | null;
  betaald_op?: string | null;
  now?: Date;
}): boolean {
  if (opts.status === "betaald" || opts.betaald_op) return false;
  if (!factuurIsOpenstaand(opts.status)) return false;
  if (!opts.vervaldatum) return false;
  const end = vervaldatumEndOfDay(opts.vervaldatum);
  return end.getTime() < (opts.now || new Date()).getTime();
}

export function betalingsOmschrijving(offerteNummer?: string | null): string {
  return (offerteNummer || "").trim() || "";
}

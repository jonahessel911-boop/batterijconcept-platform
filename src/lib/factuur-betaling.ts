import { addDays, differenceInCalendarDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

/** Standaard betaaltermijn na verzenden factuur. */
export const FACTUUR_BETAALTERMIJN_DAGEN = 3;

export const COMPANY_IBAN_DISPLAY = "NL48 BUNQ 2209 5579 33";
export const COMPANY_IBAN_COMPACT = "NL48BUNQ2209557933";
export const COMPANY_ACCOUNT_NAME = "BatterijConcept";

/** Parse gebruikersinvoer (dagen); fallback bij leeg/ongeldig. */
export function parseBetaaltermijnDagen(
  raw: unknown,
  fallback = FACTUUR_BETAALTERMIJN_DAGEN
): number {
  if (raw == null || raw === "") return fallback;
  const n =
    typeof raw === "string"
      ? Number(raw.trim().replace(",", "."))
      : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const days = Math.round(n);
  if (days < 0 || days > 365) return fallback;
  return days;
}

/**
 * Betaaltermijn in dagen afleiden uit factuurdatum → vervaldatum.
 * Gebruikt voor PDF-tekst en herberekenen bij versturen.
 */
export function factuurBetaaltermijnDagen(opts: {
  factuurdatum?: string | null;
  vervaldatum?: string | null;
  fallback?: number;
}): number {
  const fallback = opts.fallback ?? FACTUUR_BETAALTERMIJN_DAGEN;
  if (!opts.factuurdatum || !opts.vervaldatum) return fallback;
  const start = toZonedTime(
    new Date(`${opts.factuurdatum.slice(0, 10)}T12:00:00`),
    AMSTERDAM_TZ
  );
  const end = toZonedTime(
    new Date(`${opts.vervaldatum.slice(0, 10)}T12:00:00`),
    AMSTERDAM_TZ
  );
  const days = differenceInCalendarDays(end, start);
  if (!Number.isFinite(days) || days < 0 || days > 365) return fallback;
  return days;
}

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

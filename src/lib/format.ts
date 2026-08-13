import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";

const TZ = "Europe/Amsterdam";

/** Datum in NL/Amsterdam formaat, bijv. "13 augustus 2026" */
export function formatDateNl(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, TZ, "d MMMM yyyy", { locale: nl });
}

/** Korte datum: 13-08-2026 */
export function formatDateShort(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, TZ, "dd-MM-yyyy", { locale: nl });
}

/** Datum + tijd: 13-08-2026 14:32 */
export function formatDateTimeNl(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, TZ, "dd-MM-yyyy HH:mm", { locale: nl });
}

/** Datum + tijd lang: donderdag 13 augustus 2026 om 14:30 */
export function formatDateTimeLongNl(
  date: Date | string | null | undefined
): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, TZ, "EEEE d MMMM yyyy 'om' HH:mm", { locale: nl });
}

/** Alleen tijd: 14:30 */
export function formatTimeNl(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, TZ, "HH:mm", { locale: nl });
}

export const AMSTERDAM_TZ = TZ;

export function formatEuro(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

export function adresRegel(lead: {
  postcode?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  straat?: string | null;
  plaats?: string | null;
}): string {
  const nr = [lead.huisnummer, lead.toevoeging].filter(Boolean).join("");
  const line1 = [lead.straat, nr].filter(Boolean).join(" ");
  const line2 = [lead.postcode, lead.plaats].filter(Boolean).join(" ");
  return [line1, line2].filter(Boolean).join(", ") || "—";
}

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

/**
 * Slot-label met cijferlijke tijd (CRM-UI): "zat 3 okt. om 19:00"
 */
export function formatSlotLabelNl(
  date: Date | string | null | undefined,
  opts?: { kort?: boolean }
): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const dag = formatInTimeZone(
    d,
    TZ,
    opts?.kort ? "EEE d MMM" : "EEEE d MMMM",
    { locale: nl }
  );
  return `${dag} om ${formatTimeNl(d)}`;
}

const UUR_SPRAAK: Record<number, string> = {
  0: "twaalf",
  1: "één",
  2: "twee",
  3: "drie",
  4: "vier",
  5: "vijf",
  6: "zes",
  7: "zeven",
  8: "acht",
  9: "negen",
  10: "tien",
  11: "elf",
  12: "twaalf",
  13: "dertien",
  14: "veertien",
  15: "vijftien",
  16: "zestien",
  17: "zeventien",
  18: "achttien",
  19: "negentien",
  20: "twintig",
  21: "éénentwintig",
  22: "tweeëntwintig",
  23: "drieëntwintig",
};

/**
 * Tijd uitgesproken voor TTS (Retell): 10:00 → "tien uur", 13:30 → "dertien uur dertig".
 */
export function formatTimeSpokenNl(
  date: Date | string | null | undefined
): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const hour = Number(formatInTimeZone(d, TZ, "H"));
  const minute = Number(formatInTimeZone(d, TZ, "m"));
  const uurWoord = UUR_SPRAAK[hour] ?? String(hour);
  if (minute === 0) return `${uurWoord} uur`;
  if (minute === 15) return `${uurWoord} uur vijftien`;
  if (minute === 30) return `${uurWoord} uur dertig`;
  if (minute === 45) return `${uurWoord} uur vijfenveertig`;
  const minWoord =
    minute < 10
      ? `nul ${UUR_SPRAAK[minute] ?? minute}`
      : String(minute);
  return `${uurWoord} uur ${minWoord}`;
}

/** Slot-label voor voice: "zaterdag 19 september om tien uur" */
export function formatSlotLabelSpokenNl(
  date: Date | string | null | undefined,
  opts?: { kort?: boolean }
): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const dag = formatInTimeZone(
    d,
    TZ,
    opts?.kort ? "EEE d MMM" : "EEEE d MMMM",
    { locale: nl }
  );
  return `${dag} om ${formatTimeSpokenNl(d)}`;
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

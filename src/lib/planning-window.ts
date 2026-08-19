import { addDays, addHours } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

/** Tijdvenster voor schouw/installatie: starttijd t/m +4 uur (Amsterdam). */
export function planningVensterNl(at: Date | string): {
  start: string;
  end: string;
  label: string;
} {
  const d = typeof at === "string" ? new Date(at) : at;
  const zoned = toZonedTime(d, AMSTERDAM_TZ);
  const start = formatInTimeZone(zoned, AMSTERDAM_TZ, "HH:mm");
  const end = formatInTimeZone(addHours(zoned, 4), AMSTERDAM_TZ, "HH:mm");
  return {
    start,
    end,
    label: `${start} – ${end} (Amsterdam)`,
  };
}

/** yyyy-MM-dd in Amsterdam — voor cron “morgen”. */
export function dayKeyAmsterdam(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

/** Is `eventAt` op de dag na `reference` (Amsterdam)? */
export function isTomorrowAmsterdam(
  eventAt: Date | string,
  reference: Date = new Date()
): boolean {
  const refZoned = toZonedTime(reference, AMSTERDAM_TZ);
  const tomorrowKey = dayKeyAmsterdam(addDays(refZoned, 1));
  return dayKeyAmsterdam(eventAt) === tomorrowKey;
}

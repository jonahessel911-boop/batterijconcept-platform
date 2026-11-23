import { formatInTimeZone } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Zelfde kalenderdag in Europe/Amsterdam? */
export function sameAmsterdamDay(a: Date, b: Date): boolean {
  return (
    formatInTimeZone(a, AMSTERDAM_TZ, "yyyy-MM-dd") ===
    formatInTimeZone(b, AMSTERDAM_TZ, "yyyy-MM-dd")
  );
}

/**
 * Geen follow-up stap op de dag van inplannen (bevestiging mail+SMS).
 * Voorkomt o.a. bevestiging + 48u/avond op dezelfde dag.
 */
function isBevestigingDay(now: Date, createdAt: Date): boolean {
  return sameAmsterdamDay(now, createdAt);
}

/** Social-proof (intensief): ~dag 3 na inplannen, alleen bij genoeg leadtime. */
export function shouldSendSocialProofNow(opts: {
  now: Date;
  createdAt: Date;
  startAt: Date;
  bevestigingSent: boolean;
  alreadySent: boolean;
}): boolean {
  if (opts.alreadySent || !opts.bevestigingSent) return false;
  if (isBevestigingDay(opts.now, opts.createdAt)) return false;

  const leadtimeAtCreate = opts.startAt.getTime() - opts.createdAt.getTime();
  // ≤ 4 dagen leadtime → overslaan (direct naar 48u-zone)
  if (leadtimeAtCreate < 4 * DAY) return false;

  const msUntil = opts.startAt.getTime() - opts.now.getTime();
  // Niet sturen in/na de 48u-zone
  if (msUntil <= 49 * HOUR) return false;

  const sinceCreate = opts.now.getTime() - opts.createdAt.getTime();
  // Vanaf ~72u na inplannen (dag 3), met inhaal tot aan 48u-zone
  if (sinceCreate < 72 * HOUR) return false;
  return true;
}

/**
 * 48u reminder (intensief): venster ~47–49u vóór start (uurlijkse cron).
 * Nooit op dezelfde Amsterdam-dag als de bevestiging.
 */
export function shouldSendReminder48uNow(opts: {
  now: Date;
  startAt: Date;
  createdAt: Date;
  bevestigingSent: boolean;
  alreadySent: boolean;
}): boolean {
  if (opts.alreadySent || !opts.bevestigingSent) return false;
  if (isBevestigingDay(opts.now, opts.createdAt)) return false;
  const msUntil = opts.startAt.getTime() - opts.now.getTime();
  return msUntil >= 47 * HOUR && msUntil <= 49 * HOUR;
}

/**
 * Avond vóór SMS (intensief + rustig).
 * Amsterdam-kalenderdag vóór de afspraak, tussen 18:00–20:00.
 * Nooit op dezelfde dag als de bevestiging (bijv. vandaag ingepland voor morgen).
 */
export function shouldSendAvondSmsNow(opts: {
  now: Date;
  startAt: Date;
  createdAt: Date;
  alreadySent: boolean;
}): boolean {
  if (opts.alreadySent) return false;
  if (isBevestigingDay(opts.now, opts.createdAt)) return false;

  const apptDay = formatInTimeZone(opts.startAt, AMSTERDAM_TZ, "yyyy-MM-dd");
  const today = formatInTimeZone(opts.now, AMSTERDAM_TZ, "yyyy-MM-dd");
  const hour = Number(formatInTimeZone(opts.now, AMSTERDAM_TZ, "H"));

  // Dag vóór afspraak?
  const appt = new Date(`${apptDay}T12:00:00`);
  const tod = new Date(`${today}T12:00:00`);
  const dayDiff = Math.round(
    (appt.getTime() - tod.getTime()) / (24 * 60 * 60 * 1000)
  );
  if (dayDiff !== 1) return false;

  return hour >= 18 && hour < 20;
}

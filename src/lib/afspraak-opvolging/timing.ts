import { formatInTimeZone } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Social-proof (intensief): ~dag 3 na inplannen, alleen bij genoeg leadtime. */
export function shouldSendSocialProofNow(opts: {
  now: Date;
  createdAt: Date;
  startAt: Date;
  bevestigingSent: boolean;
  alreadySent: boolean;
}): boolean {
  if (opts.alreadySent || !opts.bevestigingSent) return false;

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

/** 48u reminder (intensief): venster ~47–49u vóór start (uurlijkse cron). */
export function shouldSendReminder48uNow(opts: {
  now: Date;
  startAt: Date;
  bevestigingSent: boolean;
  alreadySent: boolean;
}): boolean {
  if (opts.alreadySent || !opts.bevestigingSent) return false;
  const msUntil = opts.startAt.getTime() - opts.now.getTime();
  return msUntil >= 47 * HOUR && msUntil <= 49 * HOUR;
}

/**
 * Avond vóór SMS (intensief + rustig).
 * Amsterdam-kalenderdag vóór de afspraak, tussen 18:00–20:00.
 */
export function shouldSendAvondSmsNow(opts: {
  now: Date;
  startAt: Date;
  alreadySent: boolean;
}): boolean {
  if (opts.alreadySent) return false;

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

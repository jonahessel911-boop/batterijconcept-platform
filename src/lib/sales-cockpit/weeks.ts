import { addDays, addWeeks } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";

export function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function noon(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
}

export function addYmd(ymd: string, days: number): string {
  return ymdAmsterdam(addDays(noon(ymd), days));
}

export function currentWeekKey(now = new Date()): string {
  const w = schouwWeekFromDate(toZonedTime(now, AMSTERDAM_TZ));
  return schouwWeekValue(w.jaar, w.week);
}

export function shiftWeek(weekKey: string, delta: number): string {
  const parsed = parseSchouwWeekValue(weekKey);
  if (!parsed) return currentWeekKey();
  const monday = new Date(schouwWeekToMondayIso(parsed.jaar, parsed.week));
  const next = schouwWeekFromDate(addWeeks(monday, delta));
  return schouwWeekValue(next.jaar, next.week);
}

export type WeekBounds = {
  key: string;
  week: number;
  jaar: number;
  startYmd: string;
  endYmd: string;
  startIso: string;
  endIsoExclusive: string;
  label: string;
};

export function weekBounds(weekKey: string): WeekBounds | null {
  const parsed = parseSchouwWeekValue(weekKey);
  if (!parsed) return null;
  const mondayIso = schouwWeekToMondayIso(parsed.jaar, parsed.week);
  const startYmd = formatInTimeZone(new Date(mondayIso), AMSTERDAM_TZ, "yyyy-MM-dd");
  const endYmd = addYmd(startYmd, 6);
  const startIso = fromZonedTime(
    new Date(
      Number(startYmd.slice(0, 4)),
      Number(startYmd.slice(5, 7)) - 1,
      Number(startYmd.slice(8, 10)),
      0,
      0,
      0,
      0
    ),
    AMSTERDAM_TZ
  ).toISOString();
  const next = addYmd(endYmd, 1);
  const endIsoExclusive = fromZonedTime(
    new Date(
      Number(next.slice(0, 4)),
      Number(next.slice(5, 7)) - 1,
      Number(next.slice(8, 10)),
      0,
      0,
      0,
      0
    ),
    AMSTERDAM_TZ
  ).toISOString();
  return {
    key: schouwWeekValue(parsed.jaar, parsed.week),
    week: parsed.week,
    jaar: parsed.jaar,
    startYmd,
    endYmd,
    startIso,
    endIsoExclusive,
    label: `Week ${parsed.week}`,
  };
}

export function weekKeyOfInstant(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const w = schouwWeekFromDate(d);
  return schouwWeekValue(w.jaar, w.week);
}

export function ymdOfInstant(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return ymdAmsterdam(d);
}

/** Laatste n volledig afgeronde weken, eindigend vóór een nog lopende week. */
export function completedWeekKeys(
  now: Date,
  anchorKey: string,
  n: number
): string[] {
  const anchor = weekBounds(anchorKey);
  if (!anchor || n <= 0) return [];
  const today = ymdAmsterdam(now);
  let end = anchor.key;
  if (today <= anchor.endYmd) end = shiftWeek(anchor.key, -1);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(shiftWeek(end, -i));
  return keys;
}

export function weeksBetween(fromKey: string, toKey: string): number | null {
  const a = weekBounds(fromKey);
  const b = weekBounds(toKey);
  if (!a || !b) return null;
  const ms = noon(b.startYmd).getTime() - noon(a.startYmd).getTime();
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
}

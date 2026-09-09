/**
 * Werktijd-minuten tussen twee tijdstippen (Europe/Amsterdam).
 * Open: ma–vr 09:00–19:00. Weekend / buiten uren telt niet mee;
 * de klok start bij het begin van het eerstvolgende open blok.
 */

import { addDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export const BUSINESS_OPEN_HOUR = 9;
export const BUSINESS_CLOSE_HOUR = 19;

function zonedParts(d: Date) {
  const z = toZonedTime(d, AMSTERDAM_TZ);
  return {
    y: z.getFullYear(),
    m: z.getMonth(),
    day: z.getDate(),
    hour: z.getHours(),
    minute: z.getMinutes(),
    second: z.getSeconds(),
    ms: z.getMilliseconds(),
    dow: z.getDay(), // 0=zo … 6=za
  };
}

function atLocal(
  y: number,
  m: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
  ms = 0
): Date {
  return fromZonedTime(new Date(y, m, day, hour, minute, second, ms), AMSTERDAM_TZ);
}

function isWeekendDow(dow: number): boolean {
  return dow === 0 || dow === 6;
}

/** Start van het open blok op de kalenderdag van `d` (09:00 Amsterdam). */
export function businessDayOpen(d: Date): Date {
  const p = zonedParts(d);
  return atLocal(p.y, p.m, p.day, BUSINESS_OPEN_HOUR);
}

/** Einde van het open blok op de kalenderdag van `d` (19:00 Amsterdam). */
export function businessDayClose(d: Date): Date {
  const p = zonedParts(d);
  return atLocal(p.y, p.m, p.day, BUSINESS_CLOSE_HOUR);
}

/**
 * Als `instant` binnen werktijd valt → zelfde moment.
 * Anders → start van het eerstvolgende open blok (ma–vr 09:00).
 */
export function clampToBusinessStart(instant: Date | string): Date {
  const at = typeof instant === "string" ? new Date(instant) : instant;
  let cursor = at;
  for (let i = 0; i < 10; i++) {
    const p = zonedParts(cursor);
    if (isWeekendDow(p.dow)) {
      // Naar maandag 09:00
      const daysUntilMon = p.dow === 0 ? 1 : 2;
      const next = addDays(
        atLocal(p.y, p.m, p.day, BUSINESS_OPEN_HOUR),
        daysUntilMon
      );
      cursor = next;
      continue;
    }
    const open = businessDayOpen(cursor);
    const close = businessDayClose(cursor);
    if (cursor.getTime() < open.getTime()) return open;
    if (cursor.getTime() < close.getTime()) return cursor;
    // Na sluiting → volgende werkdag 09:00
    const nextDay = addDays(atLocal(p.y, p.m, p.day, BUSINESS_OPEN_HOUR), 1);
    cursor = nextDay;
  }
  return cursor;
}

/**
 * Minuten werktijd van `from` tot `to` (alleen ma–vr 09–19 Amsterdam).
 * `from` wordt eerst geclampt naar business start.
 */
export function businessMinutesBetween(
  from: Date | string,
  to: Date | string
): number {
  const end = typeof to === "string" ? new Date(to) : to;
  let start = clampToBusinessStart(from);
  if (end.getTime() <= start.getTime()) return 0;

  let totalMs = 0;
  let cursor = start;
  // Max ~60 dagen bescherming
  for (let i = 0; i < 60 && cursor.getTime() < end.getTime(); i++) {
    const p = zonedParts(cursor);
    if (isWeekendDow(p.dow)) {
      const daysUntilMon = p.dow === 0 ? 1 : 2;
      cursor = addDays(
        atLocal(p.y, p.m, p.day, BUSINESS_OPEN_HOUR),
        daysUntilMon
      );
      continue;
    }
    const open = businessDayOpen(cursor);
    const close = businessDayClose(cursor);
    const segStart = Math.max(cursor.getTime(), open.getTime());
    const segEnd = Math.min(end.getTime(), close.getTime());
    if (segEnd > segStart) totalMs += segEnd - segStart;

    if (end.getTime() <= close.getTime()) break;
    // Volgende kalenderdag 09:00
    cursor = addDays(atLocal(p.y, p.m, p.day, BUSINESS_OPEN_HOUR), 1);
  }

  return Math.round(totalMs / 60000);
}

export function medianOf(sortedAsc: number[]): number | null {
  if (sortedAsc.length === 0) return null;
  const mid = Math.floor(sortedAsc.length / 2);
  if (sortedAsc.length % 2 === 0) {
    return Math.round((sortedAsc[mid - 1] + sortedAsc[mid]) / 2);
  }
  return sortedAsc[mid];
}

export function percentileOf(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1)
  );
  return sortedAsc[idx];
}

export function averageOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

import {
  addDays,
  addMinutes,
  setHours,
  setMinutes,
  setSeconds,
  startOfDay,
} from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

const SLOT_MINUTES = 60;

/** Vaste tijdslots per adviseur per dag (Europe/Amsterdam) */
export const ADVISEUR_SLOT_HOURS = [10, 12, 14, 16, 18, 20] as const;

export type BusySlot = { start_at: string; end_at: string };

/**
 * Genereert beschikbare slots (Europe/Amsterdam) voor de komende dagen:
 * 10:00, 12:00, 14:00, 16:00, 18:00, 20:00 — exclusief bezette afspraken.
 */
export function generateAvailableSlots(opts: {
  daysAhead?: number;
  busy: BusySlot[];
  fromDate?: Date;
  /** Alleen weekdagen (ma–vr). Default: true */
  weekdaysOnly?: boolean;
}): { start: Date; end: Date }[] {
  const daysAhead = opts.daysAhead ?? 21;
  const weekdaysOnly = opts.weekdaysOnly ?? true;
  const from = opts.fromDate ?? new Date();
  const slots: { start: Date; end: Date }[] = [];

  for (let d = 1; d <= daysAhead; d++) {
    const dayLocal = toZonedTime(addDays(from, d), AMSTERDAM_TZ);
    const dow = dayLocal.getDay();
    if (weekdaysOnly && (dow === 0 || dow === 6)) continue;

    const dayBase = setSeconds(
      setMinutes(setHours(startOfDay(dayLocal), 0), 0),
      0
    );

    for (const hour of ADVISEUR_SLOT_HOURS) {
      const slotStartLocal = setHours(dayBase, hour);
      const slotEndLocal = addMinutes(slotStartLocal, SLOT_MINUTES);

      const startUtc = fromZonedTime(slotStartLocal, AMSTERDAM_TZ);
      const endUtc = fromZonedTime(slotEndLocal, AMSTERDAM_TZ);

      if (startUtc <= from) continue;

      const overlaps = opts.busy.some((b) => {
        const bStart = new Date(b.start_at).getTime();
        const bEnd = new Date(b.end_at).getTime();
        return startUtc.getTime() < bEnd && endUtc.getTime() > bStart;
      });

      if (!overlaps) {
        slots.push({ start: startUtc, end: endUtc });
      }
    }
  }

  return slots;
}

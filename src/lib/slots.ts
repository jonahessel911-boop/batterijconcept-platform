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

export type BusySlot = { start_at: string; end_at: string };

/**
 * Genereert beschikbare slots (Europe/Amsterdam) voor de komende dagen,
 * ma–vr tussen startUur–eindUur, exclusief bezette afspraken.
 */
export function generateAvailableSlots(opts: {
  daysAhead?: number;
  startHour?: number;
  endHour?: number;
  busy: BusySlot[];
  fromDate?: Date;
}): { start: Date; end: Date }[] {
  const daysAhead = opts.daysAhead ?? 21;
  const startHour = opts.startHour ?? 9;
  const endHour = opts.endHour ?? 17;
  const from = opts.fromDate ?? new Date();
  const slots: { start: Date; end: Date }[] = [];

  for (let d = 1; d <= daysAhead; d++) {
    const dayLocal = toZonedTime(addDays(from, d), AMSTERDAM_TZ);
    const dow = dayLocal.getDay(); // 0=zo
    if (dow === 0 || dow === 6) continue;

    const dayStartLocal = setSeconds(
      setMinutes(setHours(startOfDay(dayLocal), startHour), 0),
      0
    );

    for (let h = startHour; h < endHour; h++) {
      const slotStartLocal = setHours(dayStartLocal, h);
      const slotEndLocal = addMinutes(slotStartLocal, SLOT_MINUTES);
      if (slotEndLocal.getHours() > endHour || (slotEndLocal.getHours() === endHour && slotEndLocal.getMinutes() > 0)) {
        if (h + SLOT_MINUTES / 60 > endHour) break;
      }

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

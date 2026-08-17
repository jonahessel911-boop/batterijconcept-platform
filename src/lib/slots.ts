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

const SLOT_MINUTES = 120;

/**
 * Vijf afspraakblokken per dag (Europe/Amsterdam).
 * 2 uur afspraak + 1 uur reistijd:
 * 10:00–12:00, 13:00–15:00, 16:00–18:00, 19:00–21:00, 22:00–00:00.
 */
export const AFSPRAAK_DUUR_MINUTEN = SLOT_MINUTES;
export const ADVISEUR_SLOT_HOURS = [10, 13, 16, 19, 22] as const;

export type BusySlot = { start_at: string; end_at: string };

export type DayBlock = { start: Date; end: Date; busy: boolean };

function overlapsBusy(startUtc: Date, endUtc: Date, busy: BusySlot[]) {
  return busy.some((b) => {
    const bStart = new Date(b.start_at).getTime();
    const bEnd = new Date(b.end_at).getTime();
    return startUtc.getTime() < bEnd && endUtc.getTime() > bStart;
  });
}

/** Alle dagblokken (vrij + bezet) voor de komende dagen. */
export function generateDayBlocks(opts: {
  daysAhead?: number;
  busy: BusySlot[];
  fromDate?: Date;
  weekdaysOnly?: boolean;
}): DayBlock[] {
  const daysAhead = opts.daysAhead ?? 21;
  const weekdaysOnly = opts.weekdaysOnly ?? true;
  const from = opts.fromDate ?? new Date();
  const slots: DayBlock[] = [];

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

      slots.push({
        start: startUtc,
        end: endUtc,
        busy: overlapsBusy(startUtc, endUtc, opts.busy),
      });
    }
  }

  return slots;
}

/**
 * Beschikbare slots: 5 blokken van 2 uur met 1 uur reistijd ertussen,
 * exclusief bezette afspraken.
 */
export function generateAvailableSlots(opts: {
  daysAhead?: number;
  busy: BusySlot[];
  fromDate?: Date;
  weekdaysOnly?: boolean;
}): { start: Date; end: Date }[] {
  return generateDayBlocks(opts)
    .filter((s) => !s.busy)
    .map(({ start, end }) => ({ start, end }));
}

/** De 5 vaste blokken voor één dag (yyyy-MM-dd in Amsterdam). */
export function blocksForDayKey(dayKey: string): { start: Date; end: Date }[] {
  return ADVISEUR_SLOT_HOURS.map((hour) => {
    const start = fromZonedTime(
      `${dayKey}T${String(hour).padStart(2, "0")}:00:00`,
      AMSTERDAM_TZ
    );
    return { start, end: addMinutes(start, SLOT_MINUTES) };
  });
}

export function overlapsRange(
  startAt: string | Date,
  endAt: string | Date,
  rangeStart: Date,
  rangeEnd: Date
): boolean {
  return (
    new Date(startAt).getTime() < rangeEnd.getTime() &&
    new Date(endAt).getTime() > rangeStart.getTime()
  );
}

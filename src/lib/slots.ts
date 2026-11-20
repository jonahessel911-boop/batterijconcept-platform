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
 * Max dagen vooruit bij huisbezoek plannen (Bel + handmatig).
 * Prio: zo vroeg mogelijk binnen dit venster.
 */
export const HUISBEZOEK_PLAN_DAYS_AHEAD = 16;

/**
 * Standaard vier afspraakblokken per dag (Europe/Amsterdam).
 * 2 uur afspraak + 1 uur reistijd:
 * 10:00–12:00, 13:00–15:00, 16:00–18:00, 19:00–21:00.
 */
export const AFSPRAAK_DUUR_MINUTEN = SLOT_MINUTES;
export const ADVISEUR_SLOT_HOURS = [10, 13, 16, 19] as const;

/** Alleen Marcel Klaasman: 10 / 12 / 14 / 16 (geen 13/19). */
export const MARCEL_KLAASMAN_ADVISEUR_ID =
  "1925468e-5645-44a0-a6fc-962b95d0f46c";
export const MARCEL_KLAASMAN_SLOT_HOURS = [10, 12, 14, 16] as const;

/**
 * Warmtefonds-adviseur (Edwin): alleen kiesbaar via Acties.
 * Niet in sales-agenda / bel-planner.
 * Startadres: Bunschoten-Spakenburg. 2u-blokken.
 */
export const WF_ADVISEUR_SLOT_HOURS = [9, 11, 13, 15, 17, 19] as const;

/** Alle uren die ergens als vaste slot voorkomen (validatie / agenda-union). */
export const ALL_ADVISEUR_SLOT_HOURS = [10, 12, 13, 14, 16, 19] as const;

export type AdviseurSlotHour = (typeof ALL_ADVISEUR_SLOT_HOURS)[number];

/** Sloturen voor één adviseur. Standaard 10/13/16/19; Marcel: 10/12/14/16. */
export function slotHoursForAdviseur(
  adviseurId?: string | null
): readonly number[] {
  if (adviseurId === MARCEL_KLAASMAN_ADVISEUR_ID) {
    return MARCEL_KLAASMAN_SLOT_HOURS;
  }
  return ADVISEUR_SLOT_HOURS;
}

export function adviseurHeeftSlotUur(
  adviseurId: string | null | undefined,
  hour: number
): boolean {
  return (slotHoursForAdviseur(adviseurId) as readonly number[]).includes(
    hour
  );
}

/**
 * Agenda-raster: unie van de echte inplanuren van de zichtbare adviseurs.
 * Marcel 12/14 verschijnt dus als hij in beeld is; andere kolommen zijn
 * n.v.t. (niet “afgeblokt”).
 */
export function unionSlotHours(
  adviseurIds?: (string | null | undefined)[]
): number[] {
  const ids = (adviseurIds || []).filter(
    (id): id is string => Boolean(id)
  );
  if (ids.length === 0) return [...ADVISEUR_SLOT_HOURS];
  if (ids.length === 1) {
    return [...slotHoursForAdviseur(ids[0])];
  }
  const hours = new Set<number>();
  for (const id of ids) {
    for (const h of slotHoursForAdviseur(id)) hours.add(h);
  }
  return [...hours].sort((a, b) => a - b);
}

export function isKnownSlotHour(hour: number): hour is AdviseurSlotHour {
  return (ALL_ADVISEUR_SLOT_HOURS as readonly number[]).includes(hour);
}

export type BusySlot = { start_at: string; end_at: string };

export type DayBlock = { start: Date; end: Date; busy: boolean };

function overlapsBusy(startUtc: Date, endUtc: Date, busy: BusySlot[]) {
  return busy.some((b) => {
    const bStart = new Date(b.start_at).getTime();
    const bEnd = new Date(b.end_at).getTime();
    return startUtc.getTime() < bEnd && endUtc.getTime() > bStart;
  });
}

/** Alle dagblokken (vrij + bezet) voor de komende dagen. Ma–za; zondag uitgesloten. */
export function generateDayBlocks(opts: {
  daysAhead?: number;
  busy: BusySlot[];
  fromDate?: Date;
  /** @deprecated Alleen nog voor backwards compat; zaterdag is standaard wél beschikbaar. */
  weekdaysOnly?: boolean;
  /** Per-adviseur sloturen (o.a. Marcel Klaasman). */
  adviseurId?: string | null;
  slotHours?: readonly number[];
}): DayBlock[] {
  const daysAhead = opts.daysAhead ?? HUISBEZOEK_PLAN_DAYS_AHEAD;
  const from = opts.fromDate ?? new Date();
  const slots: DayBlock[] = [];
  const hours =
    opts.slotHours ?? slotHoursForAdviseur(opts.adviseurId);

  // d=0 = vandaag (nog vrije blokken later vandaag); al gestarte slots vallen weg via startUtc <= from
  for (let d = 0; d <= daysAhead; d++) {
    const dayLocal = toZonedTime(addDays(from, d), AMSTERDAM_TZ);
    const dow = dayLocal.getDay();
    // Zondag nooit; zaterdag wél (tenzij weekdaysOnly expliciet true)
    if (dow === 0) continue;
    if (opts.weekdaysOnly === true && dow === 6) continue;

    const dayBase = setSeconds(
      setMinutes(setHours(startOfDay(dayLocal), 0), 0),
      0
    );

    for (const hour of hours) {
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
 * Beschikbare slots: 4 blokken van 2 uur met 1 uur reistijd ertussen,
 * exclusief bezette afspraken.
 */
export function generateAvailableSlots(opts: {
  daysAhead?: number;
  busy: BusySlot[];
  fromDate?: Date;
  weekdaysOnly?: boolean;
  adviseurId?: string | null;
  slotHours?: readonly number[];
}): { start: Date; end: Date }[] {
  return generateDayBlocks(opts)
    .filter((s) => !s.busy)
    .map(({ start, end }) => ({ start, end }));
}

/** Start/eind van één vast inplanblok (yyyy-MM-dd + uur, Amsterdam). */
export function slotRangeForDayHour(
  dayKey: string,
  hour: number
): { start: Date; end: Date } {
  const start = fromZonedTime(
    `${dayKey}T${String(hour).padStart(2, "0")}:00:00`,
    AMSTERDAM_TZ
  );
  return { start, end: addMinutes(start, SLOT_MINUTES) };
}

/** De vaste blokken voor één dag (yyyy-MM-dd in Amsterdam). */
export function blocksForDayKey(
  dayKey: string,
  adviseurId?: string | null
): { start: Date; end: Date }[] {
  return slotHoursForAdviseur(adviseurId).map((hour) =>
    slotRangeForDayHour(dayKey, hour)
  );
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

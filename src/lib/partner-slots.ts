/**
 * Partner-planvensters: ochtend 09–12 (schouw) + middag 13–17 (installatie 4u / schouws).
 */
import {
  addDays,
  addMinutes,
  setHours,
  setMinutes,
  setSeconds,
  startOfDay,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  INSTALLATIE_DUUR_MINUTEN,
  SCHOUW_DUUR_MINUTEN,
} from "@/lib/planning-duur";

export type PartnerVenster = "ochtend" | "middag";
export type PartnerSlotSoort = "schouw" | "installatie";

export const PARTNER_VENSTERS = ["ochtend", "middag"] as const;

export const PARTNER_VENSTER_BOUNDS: Record<
  PartnerVenster,
  { startHour: number; startMin: number; endHour: number; endMin: number; label: string }
> = {
  ochtend: {
    startHour: 9,
    startMin: 0,
    endHour: 12,
    endMin: 0,
    label: "Ochtend 09:00–12:00",
  },
  middag: {
    startHour: 13,
    startMin: 0,
    endHour: 17,
    endMin: 0,
    label: "Middag 13:00–17:00",
  },
};

export const DEFAULT_PARTNER_REISTIJD_BUFFER_MIN = 30;

export type BusySlot = {
  start_at: string;
  end_at: string;
  address?: string | null;
};

export type PartnerDaySlot = {
  start: Date;
  end: Date;
  venster: PartnerVenster;
  busy: boolean;
  soort: PartnerSlotSoort;
};

export function isPartnerVenster(v: string): v is PartnerVenster {
  return v === "ochtend" || v === "middag";
}

export function partnerAfblokKey(
  partnerId: string,
  dag: string,
  venster: PartnerVenster
): string {
  return `${partnerId}:${dag}:${venster}`;
}

export function dayKeyAmsterdam(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function overlapsBusy(startUtc: Date, endUtc: Date, busy: BusySlot[]) {
  return busy.some((b) => {
    const bStart = new Date(b.start_at).getTime();
    const bEnd = new Date(b.end_at).getTime();
    return startUtc.getTime() < bEnd && endUtc.getTime() > bStart;
  });
}

/** Venster-grenzen als UTC Date voor een Amsterdam-dag (yyyy-MM-dd). */
export function vensterBoundsUtc(
  dayKey: string,
  venster: PartnerVenster
): { start: Date; end: Date } {
  const b = PARTNER_VENSTER_BOUNDS[venster];
  const start = fromZonedTime(
    `${dayKey}T${String(b.startHour).padStart(2, "0")}:${String(b.startMin).padStart(2, "0")}:00`,
    AMSTERDAM_TZ
  );
  const end = fromZonedTime(
    `${dayKey}T${String(b.endHour).padStart(2, "0")}:${String(b.endMin).padStart(2, "0")}:00`,
    AMSTERDAM_TZ
  );
  return { start, end };
}

/** Welk venster bevat deze starttijd (Amsterdam)? */
export function vensterForStart(start: Date): PartnerVenster | null {
  const local = toZonedTime(start, AMSTERDAM_TZ);
  const mins = local.getHours() * 60 + local.getMinutes();
  const o = PARTNER_VENSTER_BOUNDS.ochtend;
  const m = PARTNER_VENSTER_BOUNDS.middag;
  const oStart = o.startHour * 60 + o.startMin;
  const oEnd = o.endHour * 60 + o.endMin;
  const mStart = m.startHour * 60 + m.startMin;
  const mEnd = m.endHour * 60 + m.endMin;
  if (mins >= oStart && mins < oEnd) return "ochtend";
  if (mins >= mStart && mins < mEnd) return "middag";
  return null;
}

/**
 * Schouw-starts: elke 30 min binnen open vensters.
 * Ochtend 09:00…11:30, middag 13:00…16:30.
 */
export function schouwSlotStartsForDay(dayKey: string): Date[] {
  const starts: Date[] = [];
  for (const venster of PARTNER_VENSTERS) {
    const { start, end } = vensterBoundsUtc(dayKey, venster);
    let cursor = start;
    while (addMinutes(cursor, SCHOUW_DUUR_MINUTEN).getTime() <= end.getTime()) {
      starts.push(cursor);
      cursor = addMinutes(cursor, SCHOUW_DUUR_MINUTEN);
    }
  }
  return starts;
}

/** Installatie: alleen middag 13:00–17:00 (één start). */
export function installatieSlotStartsForDay(dayKey: string): Date[] {
  const { start, end } = vensterBoundsUtc(dayKey, "middag");
  const slotEnd = addMinutes(start, INSTALLATIE_DUUR_MINUTEN);
  if (slotEnd.getTime() > end.getTime()) return [];
  return [start];
}

function afblokBusyForDay(
  dayKey: string,
  blockedVensters: Set<PartnerVenster>
): BusySlot[] {
  const out: BusySlot[] = [];
  for (const v of blockedVensters) {
    const { start, end } = vensterBoundsUtc(dayKey, v);
    out.push({ start_at: start.toISOString(), end_at: end.toISOString() });
  }
  return out;
}

/**
 * Alle kandidaat-slots (vrij + bezet) voor de komende dagen.
 * Zondag uitgesloten. Afblokkingen tellen als volledig venster-bezet.
 */
export function generatePartnerDaySlots(opts: {
  soort: PartnerSlotSoort;
  daysAhead?: number;
  busy: BusySlot[];
  /** Map dayKey → set van geblokkeerde vensters */
  afblokkingen?: Map<string, Set<PartnerVenster>>;
  fromDate?: Date;
}): PartnerDaySlot[] {
  const daysAhead = opts.daysAhead ?? 28;
  const from = opts.fromDate ?? new Date();
  const duur =
    opts.soort === "installatie"
      ? INSTALLATIE_DUUR_MINUTEN
      : SCHOUW_DUUR_MINUTEN;
  const slots: PartnerDaySlot[] = [];

  for (let d = 0; d <= daysAhead; d++) {
    const dayLocal = toZonedTime(addDays(from, d), AMSTERDAM_TZ);
    if (dayLocal.getDay() === 0) continue; // zondag

    const dayBase = setSeconds(
      setMinutes(setHours(startOfDay(dayLocal), 0), 0),
      0
    );
    const dayKey = formatInTimeZone(dayBase, AMSTERDAM_TZ, "yyyy-MM-dd");
    const blocked = opts.afblokkingen?.get(dayKey) || new Set<PartnerVenster>();
    const dayBusy = [
      ...opts.busy,
      ...afblokBusyForDay(dayKey, blocked),
    ];

    const starts =
      opts.soort === "installatie"
        ? installatieSlotStartsForDay(dayKey)
        : schouwSlotStartsForDay(dayKey);

    for (const startUtc of starts) {
      if (startUtc <= from) continue;
      const endUtc = addMinutes(startUtc, duur);
      const venster = vensterForStart(startUtc);
      if (!venster) continue;
      slots.push({
        start: startUtc,
        end: endUtc,
        venster,
        soort: opts.soort,
        busy: overlapsBusy(startUtc, endUtc, dayBusy),
      });
    }
  }

  return slots;
}

export function generateAvailablePartnerSlots(opts: {
  soort: PartnerSlotSoort;
  daysAhead?: number;
  busy: BusySlot[];
  afblokkingen?: Map<string, Set<PartnerVenster>>;
  fromDate?: Date;
}): { start: Date; end: Date; venster: PartnerVenster }[] {
  return generatePartnerDaySlots(opts)
    .filter((s) => !s.busy)
    .map(({ start, end, venster }) => ({ start, end, venster }));
}

/**
 * Check of er genoeg gap is t.o.v. andere stops op dezelfde dag,
 * gegeven reistijd in minuten (of fallback buffer).
 *
 * Stops: bestaande afspraken met start/end. Candidate mag niet
 * overlappen en moet ≥ travelMin vóór/na liggen.
 */
export function fitsWithTravelGap(opts: {
  candidateStart: Date;
  candidateEnd: Date;
  sameDayStops: { start: Date; end: Date }[];
  /** Minuten die nodig zijn tussen einde vorige en start volgende */
  travelMinBefore: number;
  travelMinAfter: number;
}): boolean {
  const cStart = opts.candidateStart.getTime();
  const cEnd = opts.candidateEnd.getTime();

  for (const stop of opts.sameDayStops) {
    const sStart = stop.start.getTime();
    const sEnd = stop.end.getTime();
    // Overlap
    if (cStart < sEnd && cEnd > sStart) return false;
    // Candidate na stop: gap vanaf einde stop
    if (cStart >= sEnd) {
      const gapMin = (cStart - sEnd) / 60_000;
      if (gapMin < opts.travelMinBefore) return false;
    }
    // Candidate vóór stop: gap tot start stop
    if (cEnd <= sStart) {
      const gapMin = (sStart - cEnd) / 60_000;
      if (gapMin < opts.travelMinAfter) return false;
    }
  }
  return true;
}

/** Groepeer busy slots per Amsterdam-dag. */
export function busyByDay(
  busy: BusySlot[]
): Map<string, BusySlot[]> {
  const map = new Map<string, BusySlot[]>();
  for (const b of busy) {
    const key = dayKeyAmsterdam(b.start_at);
    const list = map.get(key) || [];
    list.push(b);
    map.set(key, list);
  }
  return map;
}

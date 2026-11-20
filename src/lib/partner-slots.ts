/**
 * Partner-planvensters:
 * - Ochtend 08–12: schouw (30m) of één installatie (4u)
 * - 12–13: pauze / reistijd (geen slots)
 * - Middag 13–17: schouw (30m) of één installatie (4u)
 * Max. 1 installatie per dag (ochtend of middag, niet allebei).
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
  installatieDuurVoorVenster,
  SCHOUW_DUUR_MINUTEN,
} from "@/lib/planning-duur";
import { isNlFeestdag } from "@/lib/nl-feestdagen";

export type PartnerVenster = "ochtend" | "middag";
export type PartnerSlotSoort = "schouw" | "installatie";

export const PARTNER_VENSTERS = ["ochtend", "middag"] as const;

export const PARTNER_VENSTER_BOUNDS: Record<
  PartnerVenster,
  { startHour: number; startMin: number; endHour: number; endMin: number; label: string }
> = {
  ochtend: {
    startHour: 8,
    startMin: 0,
    endHour: 12,
    endMin: 0,
    label: "Ochtend 08:00–12:00 (installatie)",
  },
  middag: {
    startHour: 13,
    startMin: 0,
    endHour: 17,
    endMin: 0,
    label: "Middag 13:00–17:00 (installatie)",
  },
};

export const DEFAULT_PARTNER_REISTIJD_BUFFER_MIN = 30;

/** Max. installaties per partner per kalenderdag. */
export const MAX_INSTALLATIES_PER_DAG = 1;

export type BusySlot = {
  start_at: string;
  end_at: string;
  address?: string | null;
  kind?: "schouw" | "installatie";
  naam?: string | null;
  plaats?: string | null;
  project_nummer?: string | null;
};

export type PartnerDaySlot = {
  start: Date;
  end: Date;
  venster: PartnerVenster;
  busy: boolean;
  soort: PartnerSlotSoort;
  occupancy?: number;
  capaciteit?: number;
  reason?: string;
};

/** Minstens 1 parallelle installatie per blok, anders 1 per actief koppel. */
export function installatieCapaciteitVanKoppels(koppelCount: number): number {
  return Math.max(1, koppelCount);
}

export function isPartnerVenster(v: string): v is PartnerVenster {
  return v === "ochtend" || v === "middag";
}

/**
 * Key voor afblok-set. teamgenootId null/"_" = partner-breed.
 */
export function partnerAfblokKey(
  partnerId: string,
  dag: string,
  venster: PartnerVenster,
  teamgenootId?: string | null
): string {
  const who = teamgenootId?.trim() || "_";
  return `${partnerId}:${who}:${dag}:${venster}`;
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
 * Installatie duurt tot het einde van het venster (12:00 of 17:00),
 * ook als die om 09:00 begint i.p.v. 08:00.
 */
export function installatieDuurMinutenVanaf(
  start: Date | string
): number {
  const s = typeof start === "string" ? new Date(start) : start;
  if (Number.isNaN(s.getTime())) {
    return installatieDuurVoorVenster("middag");
  }
  const venster = vensterForStart(s);
  if (!venster) return installatieDuurVoorVenster("middag");
  const { end } = vensterBoundsUtc(dayKeyAmsterdam(s), venster);
  const mins = Math.round((end.getTime() - s.getTime()) / 60_000);
  return Math.max(30, Math.min(installatieDuurVoorVenster(venster), mins));
}

/**
 * Schouw-starts: elke 30 min binnen open vensters.
 * Ochtend 08:00…11:30, middag 13:00…16:30.
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

/**
 * Installatie: ochtend 08:00 of middag 13:00 (max. 1 per dag).
 * 12:00–13:00 is pauze/reistijd (geen slot).
 */
export function installatieSlotStartsForDay(dayKey: string): Date[] {
  return PARTNER_VENSTERS.map(
    (venster) => vensterBoundsUtc(dayKey, venster).start
  );
}

export function installatieOccupancyInVenster(
  busy: BusySlot[],
  startUtc: Date,
  endUtc: Date
): number {
  const a = startUtc.getTime();
  const b = endUtc.getTime();
  return busy.filter((item) => {
    if (item.kind && item.kind !== "installatie") return false;
    const s = new Date(item.start_at).getTime();
    const e = new Date(item.end_at).getTime();
    return a < e && b > s;
  }).length;
}

export function installatieOccupancyOnDay(
  busy: BusySlot[],
  dayKey: string
): number {
  return busy.filter((item) => {
    if (item.kind && item.kind !== "installatie") return false;
    return (
      formatInTimeZone(new Date(item.start_at), AMSTERDAM_TZ, "yyyy-MM-dd") ===
      dayKey
    );
  }).length;
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
  /** Parallelle installaties per blok (koppels). Default 1. */
  installatieCapaciteit?: number;
}): PartnerDaySlot[] {
  const daysAhead = opts.daysAhead ?? 28;
  const from = opts.fromDate ?? new Date();
  const slots: PartnerDaySlot[] = [];
  const capaciteit = installatieCapaciteitVanKoppels(
    opts.installatieCapaciteit ?? 1
  );

  for (let d = 0; d <= daysAhead; d++) {
    const dayLocal = toZonedTime(addDays(from, d), AMSTERDAM_TZ);
    if (dayLocal.getDay() === 0) continue; // zondag

    const dayBase = setSeconds(
      setMinutes(setHours(startOfDay(dayLocal), 0), 0),
      0
    );
    const dayKey = formatInTimeZone(dayBase, AMSTERDAM_TZ, "yyyy-MM-dd");
    if (isNlFeestdag(dayKey)) continue;
    const blocked = opts.afblokkingen?.get(dayKey) || new Set<PartnerVenster>();
    const afblokBusy = afblokBusyForDay(dayKey, blocked);
    const dayBusy = [...opts.busy, ...afblokBusy];
    const instOpDag = installatieOccupancyOnDay(opts.busy, dayKey);

    const starts =
      opts.soort === "installatie"
        ? installatieSlotStartsForDay(dayKey)
        : schouwSlotStartsForDay(dayKey);

    for (const startUtc of starts) {
      if (startUtc <= from) continue;
      const venster = vensterForStart(startUtc);
      if (!venster) continue;
      const endUtc =
        opts.soort === "installatie"
          ? vensterBoundsUtc(dayKey, venster).end
          : addMinutes(startUtc, SCHOUW_DUUR_MINUTEN);
      // Guard: installatie-duur moet in venster passen
      if (
        opts.soort === "installatie" &&
        addMinutes(startUtc, installatieDuurVoorVenster(venster)).getTime() >
          endUtc.getTime()
      ) {
        continue;
      }
      const occupancy =
        opts.soort === "installatie"
          ? installatieOccupancyInVenster(opts.busy, startUtc, endUtc)
          : 0;
      const blockedVenster = blocked.has(venster);
      const dagVol =
        opts.soort === "installatie" && instOpDag >= MAX_INSTALLATIES_PER_DAG;
      const busy =
        opts.soort === "installatie"
          ? blockedVenster || occupancy >= capaciteit || dagVol
          : overlapsBusy(startUtc, endUtc, dayBusy);
      const reason = !busy
        ? undefined
        : dagVol
          ? "Max. 1 installatie per dag"
          : "Bezet of afgeblokt";
      slots.push({
        start: startUtc,
        end: endUtc,
        venster,
        soort: opts.soort,
        busy,
        occupancy: opts.soort === "installatie" ? occupancy : undefined,
        capaciteit: opts.soort === "installatie" ? capaciteit : undefined,
        reason,
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
  installatieCapaciteit?: number;
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

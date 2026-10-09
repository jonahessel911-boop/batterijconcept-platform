/**
 * Agenda-capaciteit → leads nodig bij 25% lead→afspraak.
 * Telt echte vrije slots: week-beschikbaarheid, afblokkingen,
 * standaard blokkades (zo / ma 10:00) en al geplande huisbezoeken.
 */

import { addDays, getISOWeek, getISOWeekYear } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import {
  afblokKey,
  dayKeyAmsterdam,
  isStandaardGeblokkeerdSlot,
  nearestSlotHour,
  weekKeyFromDate,
  weekKeyString,
} from "@/lib/adviseur-beschikbaarheid";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  AFSPRAAK_DUUR_MINUTEN,
  generateDayBlocks,
  type BusySlot,
} from "@/lib/slots";

/** Doel: 1 op 4 leads wordt een afspraak. */
export const CAPACITY_TARGET_L2A = 0.25;

export type CapacityWeekRow = {
  jaar: number;
  week: number;
  label: string;
  /** Slots na week-uit / standaard / afblokkingen (vóór gepland) */
  slotsOpen: number;
  slotsAfgeblokt: number;
  slotsGepland: number;
  slotsVrij: number;
  leadsNodig: number;
};

export type CapacityAdviseurRow = {
  id: string;
  naam: string;
  slotsOpen: number;
  slotsAfgeblokt: number;
  slotsGepland: number;
  slotsVrij: number;
  leadsNodig: number;
  weeks: CapacityWeekRow[];
};

export type DashboardV2Capacity = {
  targetLeadToAppt: number;
  weeksAhead: number;
  daysAhead: number;
  adviseurCount: number;
  slotsOpen: number;
  slotsAfgeblokt: number;
  slotsGepland: number;
  slotsVrij: number;
  /** ceil(slotsVrij / 0.25) */
  leadsNodig: number;
  /** Gemiddeld per week over het venster */
  leadsNodigPerWeek: number;
  weeks: CapacityWeekRow[];
  adviseurs: CapacityAdviseurRow[];
};

type AdviseurIn = {
  id: string;
  naam: string;
  actief: boolean;
  rol: string | null;
  email?: string | null;
};

type AfspraakIn = {
  adviseur_id: string | null;
  start_at: string;
  end_at?: string | null;
  status: string;
  soort: string | null;
};

function ceilInt(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}

function leadsForVrijeSlots(vrij: number, l2a = CAPACITY_TARGET_L2A): number {
  return ceilInt(vrij / Math.max(l2a, 0.01));
}

function emptyWeek(jaar: number, week: number): CapacityWeekRow {
  return {
    jaar,
    week,
    label: `W${week}`,
    slotsOpen: 0,
    slotsAfgeblokt: 0,
    slotsGepland: 0,
    slotsVrij: 0,
    leadsNodig: 0,
  };
}

function weekKeyOf(d: Date): { jaar: number; week: number; key: string } {
  const z = toZonedTime(d, AMSTERDAM_TZ);
  const jaar = getISOWeekYear(z);
  const week = getISOWeek(z);
  return { jaar, week, key: weekKeyString(jaar, week) };
}

function finalizeWeek(w: CapacityWeekRow): CapacityWeekRow {
  return {
    ...w,
    leadsNodig: leadsForVrijeSlots(w.slotsVrij),
  };
}

/**
 * Bouw capaciteit voor de komende `weeksAhead` ISO-weken.
 * Alleen planbare actieve sales-adviseurs.
 */
export function buildDashboardV2Capacity(opts: {
  adviseurs: AdviseurIn[];
  afspraken: AfspraakIn[];
  /** Keys `jaar-Www` waarop adviseur NIET beschikbaar is */
  unavailableByAdviseur: Map<string, Set<string>>;
  /** Keys `${adviseurId}:${yyyy-MM-dd}:${hour}` */
  afblokkingen: Set<string>;
  weeksAhead?: number;
  now?: Date;
}): DashboardV2Capacity {
  const weeksAhead = Math.min(Math.max(opts.weeksAhead ?? 4, 1), 12);
  const daysAhead = weeksAhead * 7;
  const now = opts.now ?? new Date();

  const adviseurs = opts.adviseurs
    .filter((a) => isPlanbaarAdviseur(a))
    .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));

  // Weekvolgorde voor team-totalen (komende weeksAhead ISO-weken)
  const weekOrder: { jaar: number; week: number; key: string }[] = [];
  const seenWeek = new Set<string>();
  for (let d = 1; d <= daysAhead; d++) {
    const day = addDays(now, d);
    const wk = weekKeyOf(day);
    if (seenWeek.has(wk.key)) continue;
    seenWeek.add(wk.key);
    weekOrder.push(wk);
    if (weekOrder.length >= weeksAhead) break;
  }

  const teamByWeek = new Map<string, CapacityWeekRow>();
  for (const w of weekOrder) {
    teamByWeek.set(w.key, emptyWeek(w.jaar, w.week));
  }

  const adviseurRows: CapacityAdviseurRow[] = [];

  for (const adv of adviseurs) {
    const busy: BusySlot[] = opts.afspraken
      .filter(
        (a) =>
          a.adviseur_id === adv.id &&
          a.status !== "geannuleerd" &&
          a.status !== "voltooid" &&
          afspraakBlokkeertAgenda(a.soort)
      )
      .map((a) => {
        const start = a.start_at;
        const end =
          a.end_at && a.end_at !== a.start_at
            ? a.end_at
            : new Date(
                new Date(a.start_at).getTime() + AFSPRAAK_DUUR_MINUTEN * 60_000
              ).toISOString();
        return { start_at: start, end_at: end };
      });

    const unavailable = opts.unavailableByAdviseur.get(adv.id) || new Set();
    const blocks = generateDayBlocks({
      daysAhead,
      busy,
      fromDate: now,
    });

    const advByWeek = new Map<string, CapacityWeekRow>();
    for (const w of weekOrder) {
      advByWeek.set(w.key, emptyWeek(w.jaar, w.week));
    }

    let slotsOpen = 0;
    let slotsAfgeblokt = 0;
    let slotsGepland = 0;
    let slotsVrij = 0;

    for (const block of blocks) {
      const wk = weekKeyFromDate(block.start);
      const wkKey = weekKeyString(wk.jaar, wk.week);
      if (!advByWeek.has(wkKey)) continue; // buiten venster

      const row = advByWeek.get(wkKey)!;
      const team = teamByWeek.get(wkKey);

      if (unavailable.has(wkKey)) {
        // Hele week uit — telt niet als open capaciteit
        continue;
      }

      const dag = dayKeyAmsterdam(block.start);
      const hour = nearestSlotHour(block.start);
      const blocked =
        isStandaardGeblokkeerdSlot(block.start) ||
        opts.afblokkingen.has(afblokKey(adv.id, dag, hour));

      if (blocked) {
        slotsAfgeblokt += 1;
        row.slotsAfgeblokt += 1;
        if (team) team.slotsAfgeblokt += 1;
        continue;
      }

      // Open (boekbaar) slot
      slotsOpen += 1;
      row.slotsOpen += 1;
      if (team) team.slotsOpen += 1;

      if (block.busy) {
        slotsGepland += 1;
        row.slotsGepland += 1;
        if (team) team.slotsGepland += 1;
      } else {
        slotsVrij += 1;
        row.slotsVrij += 1;
        if (team) team.slotsVrij += 1;
      }
    }

    const weeks = weekOrder.map((w) => finalizeWeek(advByWeek.get(w.key)!));
    adviseurRows.push({
      id: adv.id,
      naam: adv.naam,
      slotsOpen,
      slotsAfgeblokt,
      slotsGepland,
      slotsVrij,
      leadsNodig: leadsForVrijeSlots(slotsVrij),
      weeks,
    });
  }

  const weeks = weekOrder.map((w) => finalizeWeek(teamByWeek.get(w.key)!));
  const slotsOpen = weeks.reduce((s, w) => s + w.slotsOpen, 0);
  const slotsAfgeblokt = weeks.reduce((s, w) => s + w.slotsAfgeblokt, 0);
  const slotsGepland = weeks.reduce((s, w) => s + w.slotsGepland, 0);
  const slotsVrij = weeks.reduce((s, w) => s + w.slotsVrij, 0);
  const leadsNodig = leadsForVrijeSlots(slotsVrij);

  return {
    targetLeadToAppt: CAPACITY_TARGET_L2A,
    weeksAhead,
    daysAhead,
    adviseurCount: adviseurs.length,
    slotsOpen,
    slotsAfgeblokt,
    slotsGepland,
    slotsVrij,
    leadsNodig,
    leadsNodigPerWeek:
      weeksAhead > 0
        ? Math.round((leadsNodig / weeksAhead) * 10) / 10
        : 0,
    weeks,
    adviseurs: adviseurRows,
  };
}

/** Lege capaciteit (geen adviseurs / fout bij laden). */
export function emptyDashboardV2Capacity(
  weeksAhead = 4
): DashboardV2Capacity {
  return {
    targetLeadToAppt: CAPACITY_TARGET_L2A,
    weeksAhead,
    daysAhead: weeksAhead * 7,
    adviseurCount: 0,
    slotsOpen: 0,
    slotsAfgeblokt: 0,
    slotsGepland: 0,
    slotsVrij: 0,
    leadsNodig: 0,
    leadsNodigPerWeek: 0,
    weeks: [],
    adviseurs: [],
  };
}

/**
 * Agenda-capaciteit → leads nodig bij recente lead→afspraak %.
 * Telt echte vrije slots: week-beschikbaarheid, afblokkingen,
 * standaard blokkades (zo / ma 10:00) en al geplande huisbezoeken.
 *
 * Standaardvenster: komende 2 ISO-weken. L2A = afgelopen 7 dagen
 * (fallback 25% als er geen sample is).
 */

import { addDays, getISOWeek, getISOWeekYear } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import {
  dayKeyAmsterdam,
  isBeforeStartdatum,
  isSlotGeblokkeerd,
  nearestSlotHour,
  weekKeyFromDate,
  weekKeyString,
} from "@/lib/adviseur-beschikbaarheid";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";
import { AMSTERDAM_TZ } from "@/lib/format";
import { formatSchouwWeekLabel } from "@/lib/schouw-week";
import {
  ADVISEUR_SLOT_HOURS,
  AFSPRAAK_DUUR_MINUTEN,
  generateDayBlocks,
  type BusySlot,
} from "@/lib/slots";

/** Fallback als afgelopen 7 dagen geen bruikbare L2A opleveren. */
export const CAPACITY_TARGET_L2A = 0.25;

/** Standaard planningshorizon. */
export const CAPACITY_WEEKS_AHEAD = 2;

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
  /** Fractie 0–1 (bijv. 0.18 = 18%) — afgelopen 7d of fallback */
  targetLeadToAppt: number;
  /** true = echte L2A afgelopen 7 dagen; false = fallback 25% */
  l2aFromRecent: boolean;
  /** Leads in L2A-sample (afgelopen 7 dagen) */
  l2aSampleLeads: number;
  /** Eerste-nieuw-afspraken in L2A-sample */
  l2aSampleAfspraken: number;
  weeksAhead: number;
  daysAhead: number;
  adviseurCount: number;
  slotsOpen: number;
  slotsAfgeblokt: number;
  slotsGepland: number;
  slotsVrij: number;
  /** ceil(slotsVrij / L2A) over het venster */
  leadsNodig: number;
  /** Gemiddeld per week over het venster */
  leadsNodigPerWeek: number;
  /** Leads aangemaakt in afgelopen 7 dagen */
  leadsGegenereerd7d: number;
  /** Tempo naar 2 weken: leadsGegenereerd7d × (weeksAhead) */
  leadsGegenereerdProjected: number;
  /** leadsNodig − projected (positief = tekort) */
  leadsTekort: number;
  weeks: CapacityWeekRow[];
  adviseurs: CapacityAdviseurRow[];
};

type AdviseurIn = {
  id: string;
  naam: string;
  actief: boolean;
  rol: string | null;
  email?: string | null;
  /** Eerste planbare Amsterdam-dag; slots vóór deze datum tellen niet mee. */
  startdatum?: string | null;
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

function leadsForVrijeSlots(vrij: number, l2a: number): number {
  return ceilInt(vrij / Math.max(l2a, 0.01));
}

function emptyWeek(jaar: number, week: number): CapacityWeekRow {
  return {
    jaar,
    week,
    label: formatSchouwWeekLabel(jaar, week),
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

function finalizeWeek(w: CapacityWeekRow, l2a: number): CapacityWeekRow {
  return {
    ...w,
    leadsNodig: leadsForVrijeSlots(w.slotsVrij, l2a),
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
  /** Zondag-vrijgaven (open uitzonderingen),zelfde key-vorm */
  vrijgaven?: Set<string>;
  weeksAhead?: number;
  now?: Date;
  /** Alleen ma–vr (bel-dagoel deelt door 5 werkdagen/week). */
  weekdaysOnly?: boolean;
  /**
   * Bel-planning: sla de huidige ISO-week over en start bij de volgende
   * volle week (2 weken vooruit = week+1 en week+2).
   */
  skipCurrentIsoWeek?: boolean;
  /**
   * Start scan vanaf vandaag (d=0) i.p.v. morgen (d=1).
   * Nodig om rest van deze week mee te tellen in bel-dagoel.
   */
  includeToday?: boolean;
  /**
   * L2A als fractie (0–1). Null/undefined → fallback 25%.
   * Typisch: afgelopen 7 dagen.
   */
  targetLeadToAppt?: number | null;
  l2aSampleLeads?: number;
  l2aSampleAfspraken?: number;
  /** Leads aangemaakt in afgelopen 7 dagen */
  leadsGegenereerd7d?: number;
}): DashboardV2Capacity {
  const weeksAhead = Math.min(
    Math.max(opts.weeksAhead ?? CAPACITY_WEEKS_AHEAD, 1),
    12
  );
  const now = opts.now ?? new Date();
  const currentWeekKey = weekKeyOf(now).key;
  let scanStart = opts.includeToday ? 0 : 1;
  if (opts.skipCurrentIsoWeek) {
    for (let d = 1; d <= 14; d++) {
      if (weekKeyOf(addDays(now, d)).key !== currentWeekKey) {
        scanStart = d;
        break;
      }
    }
  }
  // Genoeg dagen om weeksAhead volle weken te bestrijken vanaf scanStart
  const daysAhead = scanStart + weeksAhead * 7 + 2;

  const sampleLeads = Math.max(0, Math.round(opts.l2aSampleLeads ?? 0));
  const sampleAfspraken = Math.max(0, Math.round(opts.l2aSampleAfspraken ?? 0));
  const rawL2a = opts.targetLeadToAppt;
  const l2aFromRecent =
    rawL2a != null &&
    Number.isFinite(rawL2a) &&
    rawL2a > 0 &&
    sampleLeads > 0;
  const l2a = l2aFromRecent
    ? Math.min(1, Math.max(0.01, rawL2a as number))
    : CAPACITY_TARGET_L2A;

  const leadsGegenereerd7d = Math.max(
    0,
    Math.round(opts.leadsGegenereerd7d ?? sampleLeads)
  );
  const leadsGegenereerdProjected = Math.round(
    leadsGegenereerd7d * weeksAhead
  );

  const adviseurs = opts.adviseurs
    .filter((a) => isPlanbaarAdviseur(a))
    .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));

  // Weekvolgorde voor team-totalen (komende weeksAhead ISO-weken)
  const weekOrder: { jaar: number; week: number; key: string }[] = [];
  const seenWeek = new Set<string>();
  for (let d = scanStart; d <= daysAhead; d++) {
    const day = addDays(now, d);
    const wk = weekKeyOf(day);
    if (opts.skipCurrentIsoWeek && wk.key === currentWeekKey) continue;
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
      weekdaysOnly: opts.weekdaysOnly === true,
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

      // Nog niet gestart — geen planbare capaciteit
      if (isBeforeStartdatum(block.start, adv.startdatum)) continue;

      const row = advByWeek.get(wkKey)!;
      const team = teamByWeek.get(wkKey);

      if (unavailable.has(wkKey)) {
        // Hele week uit — telt niet als open capaciteit
        continue;
      }

      const dag = dayKeyAmsterdam(block.start);
      const hour = nearestSlotHour(block.start);
      const blocked = isSlotGeblokkeerd(
        adv.id,
        dag,
        hour,
        opts.afblokkingen,
        opts.vrijgaven ?? new Set()
      );

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

    const weeks = weekOrder.map((w) =>
      finalizeWeek(advByWeek.get(w.key)!, l2a)
    );
    adviseurRows.push({
      id: adv.id,
      naam: adv.naam,
      slotsOpen,
      slotsAfgeblokt,
      slotsGepland,
      slotsVrij,
      leadsNodig: leadsForVrijeSlots(slotsVrij, l2a),
      weeks,
    });
  }

  const weeks = weekOrder.map((w) =>
    finalizeWeek(teamByWeek.get(w.key)!, l2a)
  );
  const slotsOpen = weeks.reduce((s, w) => s + w.slotsOpen, 0);
  const slotsAfgeblokt = weeks.reduce((s, w) => s + w.slotsAfgeblokt, 0);
  const slotsGepland = weeks.reduce((s, w) => s + w.slotsGepland, 0);
  const slotsVrij = weeks.reduce((s, w) => s + w.slotsVrij, 0);
  const leadsNodig = leadsForVrijeSlots(slotsVrij, l2a);
  const leadsTekort = leadsNodig - leadsGegenereerdProjected;

  return {
    targetLeadToAppt: l2a,
    l2aFromRecent,
    l2aSampleLeads: sampleLeads,
    l2aSampleAfspraken: sampleAfspraken,
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
    leadsGegenereerd7d,
    leadsGegenereerdProjected,
    leadsTekort,
    weeks,
    adviseurs: adviseurRows,
  };
}

/**
 * Stuurdoelen afleiden uit live capaciteit + recente L2A.
 * Weekbasis: leads/afspraken per 7 dagen; daarna schalen naar `dayCount`.
 */
export function capacitySteeringGoals(
  capacity: DashboardV2Capacity,
  dayCount: number
): {
  weekly: { leads: number; afsprakenGepland: number; leadToAppt: number };
  period: { leads: number; afsprakenGepland: number; leadToAppt: number };
} {
  const l2aPct = Math.round(capacity.targetLeadToAppt * 1000) / 10;
  const weeklyLeads = capacity.leadsNodigPerWeek;
  const weeklyAfspraken =
    capacity.weeksAhead > 0
      ? Math.round((capacity.slotsVrij / capacity.weeksAhead) * 10) / 10
      : 0;
  const factor = Math.max(1, dayCount) / 7;
  const roundVol = (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n >= 100) return Math.round(n);
    return Math.round(n * 10) / 10;
  };
  return {
    weekly: {
      leads: roundVol(weeklyLeads),
      afsprakenGepland: roundVol(weeklyAfspraken),
      leadToAppt: l2aPct,
    },
    period: {
      leads: roundVol(weeklyLeads * factor),
      afsprakenGepland: roundVol(weeklyAfspraken * factor),
      leadToAppt: l2aPct,
    },
  };
}

/**
 * Tel open (niet-afgeblokte) planbare slots in een vaste Amsterdam-ymd-range.
 * Onafhankelijk van of er al een afspraak in het blok staat — alleen
 * week-uit, standaardblokkades en afblokkingen tellen mee.
 */
export function countOpenSlotsInYmdRange(opts: {
  startYmd: string;
  endYmd: string;
  adviseurs: AdviseurIn[];
  unavailableByAdviseur: Map<string, Set<string>>;
  afblokkingen: Set<string>;
  vrijgaven?: Set<string>;
}): number {
  if (opts.startYmd > opts.endYmd) return 0;
  const adviseurs = opts.adviseurs.filter((a) => isPlanbaarAdviseur(a));
  const vrijgaven = opts.vrijgaven ?? new Set<string>();
  let open = 0;

  const [sy, sm, sd] = opts.startYmd.split("-").map(Number);
  const [ey, em, ed] = opts.endYmd.split("-").map(Number);
  let cur = fromZonedTime(new Date(sy, sm - 1, sd, 12, 0, 0), AMSTERDAM_TZ);
  const end = fromZonedTime(new Date(ey, em - 1, ed, 12, 0, 0), AMSTERDAM_TZ);

  while (cur.getTime() <= end.getTime()) {
    const dag = dayKeyAmsterdam(cur);
    const dow = toZonedTime(cur, AMSTERDAM_TZ).getDay();
    // Zondag nooit planbaar
    if (dow !== 0) {
      const wk = weekKeyFromDate(cur);
      const wkKey = weekKeyString(wk.jaar, wk.week);
      for (const adv of adviseurs) {
        if (isBeforeStartdatum(cur, adv.startdatum)) continue;
        if ((opts.unavailableByAdviseur.get(adv.id) || new Set()).has(wkKey)) {
          continue;
        }
        for (const hour of ADVISEUR_SLOT_HOURS) {
          if (
            isSlotGeblokkeerd(adv.id, dag, hour, opts.afblokkingen, vrijgaven)
          ) {
            continue;
          }
          open += 1;
        }
      }
    }
    cur = addDays(cur, 1);
  }

  return open;
}

/** Lege capaciteit (geen adviseurs / fout bij laden). */
export function emptyDashboardV2Capacity(
  weeksAhead = CAPACITY_WEEKS_AHEAD
): DashboardV2Capacity {
  return {
    targetLeadToAppt: CAPACITY_TARGET_L2A,
    l2aFromRecent: false,
    l2aSampleLeads: 0,
    l2aSampleAfspraken: 0,
    weeksAhead,
    daysAhead: weeksAhead * 7,
    adviseurCount: 0,
    slotsOpen: 0,
    slotsAfgeblokt: 0,
    slotsGepland: 0,
    slotsVrij: 0,
    leadsNodig: 0,
    leadsNodigPerWeek: 0,
    leadsGegenereerd7d: 0,
    leadsGegenereerdProjected: 0,
    leadsTekort: 0,
    weeks: [],
    adviseurs: [],
  };
}

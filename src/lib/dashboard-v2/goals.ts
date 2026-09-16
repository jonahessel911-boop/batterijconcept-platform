import { parseAdminTargetsStore, teamWeeklySnapshot } from "@/lib/admin-targets";
import type { DashboardV2Period } from "./types";

/** KPI-doelen: altijd opgegeven per 7 dagen, daarna omgerekend naar de geselecteerde periode. */
export type DashboardV2Goals = {
  leads: number;
  afsprakenGepland: number;
  /** Lead → afspraak doel in % (niet schalen — is een ratio) */
  leadToAppt: number;
  /** Afspraak → sale / closing % (niet schalen) */
  afspraakToSale: number;
  orders: number;
  /** Getekende omzet excl. btw (team) */
  omzet: number;
  /** Omzetdoel per adviseur (per 7 dagen), key = adviseur-id */
  omzetPerAdviseur: Record<string, number>;
};

export const DEFAULT_WEEKLY_GOALS: DashboardV2Goals = {
  leads: 40,
  afsprakenGepland: 10,
  leadToAppt: 25,
  afspraakToSale: 25,
  orders: 3,
  omzet: 10000,
  omzetPerAdviseur: {},
};

/** Dagen per periodefilter (vaste lengte van presets; custom/all via dayCount). */
export const PERIOD_DAYS: Record<DashboardV2Period, number> = {
  last_7_days: 7,
  calendar_week: 7,
  this_month: 30,
  last_14_days: 14,
  last_28_days: 28,
  /** ~26 weken */
  last_6_months: 182,
  all: 182,
  custom: 14,
};

function roundGoal(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 100) return Math.round(n);
  return Math.round(n * 10) / 10;
}

function scaleOmzetMap(
  map: Record<string, number>,
  factor: number
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(map)) {
    out[id] = roundGoal(v * factor);
  }
  return out;
}

/**
 * Lees weekdoelen uit Admin-store / legacy JSONB.
 * Optioneel adviseurIds om standaard omzetdoel op iedereen te zetten.
 */
export function parseWeeklyGoals(
  raw: unknown,
  people: { id: string; rol?: string | null; actief?: boolean }[] = []
): DashboardV2Goals {
  const store = parseAdminTargetsStore(raw);
  const snap = teamWeeklySnapshot(store, people);
  return {
    leads: snap.leads,
    afsprakenGepland: snap.afsprakenGepland,
    leadToAppt: snap.leadToAppt,
    afspraakToSale: snap.afspraakToSale,
    orders: snap.orders,
    omzet: snap.omzet,
    omzetPerAdviseur: snap.omzetPerAdviseur,
  };
}

/** Volume-doelen terugrekenen naar per-7-dagen (ratio blijft). */
export function scaleGoalsToWeekly(
  goals: DashboardV2Goals,
  fromDays: number
): DashboardV2Goals {
  const factor = fromDays > 0 ? 7 / fromDays : 1;
  return {
    leads: roundGoal(goals.leads * factor),
    afsprakenGepland: roundGoal(goals.afsprakenGepland * factor),
    leadToAppt: goals.leadToAppt,
    afspraakToSale: goals.afspraakToSale,
    orders: roundGoal(goals.orders * factor),
    omzet: roundGoal(goals.omzet * factor),
    omzetPerAdviseur: scaleOmzetMap(goals.omzetPerAdviseur || {}, factor),
  };
}

/** Weekdoelen omrekenen naar doelen voor N kalenderdagen. */
export function scaleWeeklyGoalsByDays(
  weekly: DashboardV2Goals,
  days: number
): DashboardV2Goals {
  const factor = Math.max(1, days) / 7;
  return {
    leads: roundGoal(weekly.leads * factor),
    afsprakenGepland: roundGoal(weekly.afsprakenGepland * factor),
    leadToAppt: weekly.leadToAppt,
    afspraakToSale: weekly.afspraakToSale,
    orders: roundGoal(weekly.orders * factor),
    omzet: roundGoal(weekly.omzet * factor),
    omzetPerAdviseur: scaleOmzetMap(weekly.omzetPerAdviseur || {}, factor),
  };
}

/** Weekdoelen omrekenen naar doelen voor de geselecteerde periode. */
export function scaleWeeklyGoalsToPeriod(
  weekly: DashboardV2Goals,
  period: DashboardV2Period
): DashboardV2Goals {
  return scaleWeeklyGoalsByDays(weekly, PERIOD_DAYS[period]);
}

/** @deprecated — Admin-tab schrijft via serializeAdminTargetsStore */
export function storeWeeklyGoals(goals: DashboardV2Goals): {
  per_7_days: DashboardV2Goals;
} {
  return {
    per_7_days: {
      leads: Math.max(0, Number(goals.leads) || 0),
      afsprakenGepland: Math.max(0, Number(goals.afsprakenGepland) || 0),
      leadToAppt: Math.max(0, Math.min(100, Number(goals.leadToAppt) || 0)),
      afspraakToSale: Math.max(
        0,
        Math.min(100, Number(goals.afspraakToSale) || 0)
      ),
      orders: Math.max(0, Number(goals.orders) || 0),
      omzet: Math.max(0, Number(goals.omzet) || 0),
      omzetPerAdviseur: goals.omzetPerAdviseur || {},
    },
  };
}

/** @deprecated */
export function parseDashboardV2Goals(
  raw: unknown,
  period: DashboardV2Period
): DashboardV2Goals {
  return scaleWeeklyGoalsToPeriod(parseWeeklyGoals(raw), period);
}

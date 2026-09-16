/**
 * Forecast KPI's: laatste 3 volledige ISO-weken + vooruitblik.
 * Week N+1 = gemiddelde van de 3 weken ervoor (forecast-op-forecast).
 */

import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import { round2 } from "@/lib/management-dashboard/periods";
import { aggRange, type DashboardV2Raw, type Range } from "./build";

const TZ = "Europe/Amsterdam";

export type ForecastWeekKind = "actual" | "forecast";

export type ForecastWeekMetrics = {
  leads: number;
  afsprakenGepland: number;
  afsprakenVoltooid: number;
  orders: number;
  omzet: number;
  leadToAppt: number;
  afspraakToSale: number;
};

export type ForecastWeek = {
  key: string;
  label: string;
  shortLabel: string;
  start: string;
  end: string;
  kind: ForecastWeekKind;
  metrics: ForecastWeekMetrics;
};

export type DashboardV2Forecast = {
  weeks: ForecastWeek[];
  historyCount: number;
  forecastCount: number;
  baseline: ForecastWeekMetrics;
};

const HISTORY = 3;
const AHEAD = 4;

function amsStartOfDay(d: Date): Date {
  const z = toZonedTime(d, TZ);
  return fromZonedTime(
    new Date(z.getFullYear(), z.getMonth(), z.getDate(), 0, 0, 0, 0),
    TZ
  );
}

function amsEndOfDay(d: Date): Date {
  const z = toZonedTime(d, TZ);
  return fromZonedTime(
    new Date(z.getFullYear(), z.getMonth(), z.getDate(), 23, 59, 59, 999),
    TZ
  );
}

function isoWeekRange(jaar: number, week: number): Range {
  const monday = new Date(schouwWeekToMondayIso(jaar, week));
  return {
    start: amsStartOfDay(monday),
    end: amsEndOfDay(addDays(monday, 6)),
  };
}

function prevIsoWeek(jaar: number, week: number): { jaar: number; week: number } {
  const monday = new Date(schouwWeekToMondayIso(jaar, week));
  return schouwWeekFromDate(addDays(monday, -7));
}

function nextIsoWeek(jaar: number, week: number): { jaar: number; week: number } {
  const monday = new Date(schouwWeekToMondayIso(jaar, week));
  return schouwWeekFromDate(addDays(monday, 7));
}

function emptyMetrics(): ForecastWeekMetrics {
  return {
    leads: 0,
    afsprakenGepland: 0,
    afsprakenVoltooid: 0,
    orders: 0,
    omzet: 0,
    leadToAppt: 0,
    afspraakToSale: 0,
  };
}

function fromAgg(t: ReturnType<typeof aggRange>): ForecastWeekMetrics {
  return {
    leads: t.leads,
    afsprakenGepland: t.afsprakenGepland,
    afsprakenVoltooid: t.afsprakenVoltooid,
    orders: t.orders,
    omzet: t.omzet,
    leadToAppt: t.leadToAppt ?? 0,
    afspraakToSale: t.afspraakToSale ?? 0,
  };
}

function avgMetrics(rows: ForecastWeekMetrics[]): ForecastWeekMetrics {
  const n = Math.max(rows.length, 1);
  const sum = emptyMetrics();
  for (const r of rows) {
    sum.leads += r.leads;
    sum.afsprakenGepland += r.afsprakenGepland;
    sum.afsprakenVoltooid += r.afsprakenVoltooid;
    sum.orders += r.orders;
    sum.omzet += r.omzet;
    sum.leadToAppt += r.leadToAppt;
    sum.afspraakToSale += r.afspraakToSale;
  }
  return {
    leads: round2(sum.leads / n),
    afsprakenGepland: round2(sum.afsprakenGepland / n),
    afsprakenVoltooid: round2(sum.afsprakenVoltooid / n),
    orders: round2(sum.orders / n),
    omzet: round2(sum.omzet / n),
    leadToAppt: round2(sum.leadToAppt / n),
    afspraakToSale: round2(sum.afspraakToSale / n),
  };
}

/**
 * Laatste `history` volledige ISO-weken vóór de huidige week,
 * plus `ahead` forecast-weken (rolling 3-weken-gemiddelde, ook op forecasts).
 */
export function buildDashboardV2Forecast(
  raw: DashboardV2Raw,
  now = new Date(),
  historyCount = HISTORY,
  forecastCount = AHEAD
): DashboardV2Forecast {
  const z = toZonedTime(now, TZ);
  let cursor = schouwWeekFromDate(z);
  // Start vanaf vorige volledige week (huidige week is incompleet)
  cursor = prevIsoWeek(cursor.jaar, cursor.week);

  const historyKeys: { jaar: number; week: number }[] = [];
  for (let i = 0; i < historyCount; i++) {
    historyKeys.unshift({ ...cursor });
    cursor = prevIsoWeek(cursor.jaar, cursor.week);
  }

  const historyWeeks: ForecastWeek[] = historyKeys.map(({ jaar, week }) => {
    const range = isoWeekRange(jaar, week);
    const metrics = fromAgg(aggRange(raw, range, now));
    return {
      key: schouwWeekValue(jaar, week),
      label: `W${week} · ${formatInTimeZone(range.start, TZ, "d MMM")}–${formatInTimeZone(range.end, TZ, "d MMM")}`,
      shortLabel: `W${week}`,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      kind: "actual" as const,
      metrics,
    };
  });

  const series: ForecastWeekMetrics[] = historyWeeks.map((w) => w.metrics);
  const baseline = avgMetrics(series);

  const lastHist = historyKeys[historyKeys.length - 1];
  let fc = lastHist
    ? nextIsoWeek(lastHist.jaar, lastHist.week)
    : schouwWeekFromDate(z);

  const forecastWeeks: ForecastWeek[] = [];
  for (let i = 0; i < forecastCount; i++) {
    const window = series.slice(-historyCount);
    const metrics = avgMetrics(window);
    const range = isoWeekRange(fc.jaar, fc.week);
    forecastWeeks.push({
      key: `fc-${schouwWeekValue(fc.jaar, fc.week)}`,
      label: `FC W${fc.week} · ${formatInTimeZone(range.start, TZ, "d MMM")}–${formatInTimeZone(range.end, TZ, "d MMM")}`,
      shortLabel: `FC W${fc.week}`,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      kind: "forecast",
      metrics,
    });
    series.push(metrics);
    fc = nextIsoWeek(fc.jaar, fc.week);
  }

  return {
    weeks: [...historyWeeks, ...forecastWeeks],
    historyCount,
    forecastCount,
    baseline,
  };
}

/**
 * Periodefilters voor Bel- en Lead-conversie dashboards.
 */

import { addDays, startOfQuarter, startOfYear } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  schouwWeekFromDate,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";

export type ConversiePeriod =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_14_days"
  | "last_30_days"
  | "this_quarter"
  | "this_year"
  | "all_time";

export const CONVERSIE_PERIOD_LABELS: Record<ConversiePeriod, string> = {
  today: "Vandaag",
  yesterday: "Gisteren",
  last_7_days: "Afgelopen 7 dagen",
  last_14_days: "Afgelopen 14 dagen",
  last_30_days: "Afgelopen 30 dagen",
  this_quarter: "Dit kwartaal",
  this_year: "Dit jaar",
  all_time: "Maximaal",
};

/** Volgorde in de periode-selector. */
export const CONVERSIE_PERIODS: ConversiePeriod[] = [
  "today",
  "yesterday",
  "last_7_days",
  "last_14_days",
  "last_30_days",
  "this_quarter",
  "this_year",
  "all_time",
];

export type ResolvedConversiePeriod = {
  period: ConversiePeriod;
  label: string;
  startYmd: string;
  endYmd: string;
  /** Inclusief aantal kalenderdagen */
  days: number;
};

function ymdAmsterdam(d: Date): string {
  const z = toZonedTime(d, AMSTERDAM_TZ);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, "0");
  const day = String(z.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function noonAmsterdamFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
}

function shiftYmd(ymd: string, deltaDays: number): string {
  return ymdAmsterdam(addDays(noonAmsterdamFromYmd(ymd), deltaDays));
}

function daysInclusive(startYmd: string, endYmd: string): number {
  const a = noonAmsterdamFromYmd(startYmd).getTime();
  const b = noonAmsterdamFromYmd(endYmd).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export function parseConversiePeriod(
  raw: string | null | undefined
): ConversiePeriod {
  const v = (raw || "").trim();
  if (
    v === "today" ||
    v === "yesterday" ||
    v === "last_7_days" ||
    v === "last_14_days" ||
    v === "last_30_days" ||
    v === "this_quarter" ||
    v === "this_year" ||
    v === "all_time"
  ) {
    return v;
  }
  // Aliassen
  if (v === "gisteren" || v === "1d") return "yesterday";
  if (v === "7d" || v === "last_7") return "last_7_days";
  if (v === "14d" || v === "last_14") return "last_14_days";
  if (v === "30d" || v === "last_30") return "last_30_days";
  if (v === "quarter" || v === "kwartaal") return "this_quarter";
  if (v === "year" || v === "jaar") return "this_year";
  if (v === "max" || v === "all" || v === "maximaal") return "all_time";
  return "today";
}

/**
 * Resolve periode t/m vandaag (Amsterdam), inclusief.
 * last_N = vandaag en N−1 dagen terug.
 * yesterday = alleen gisteren (start = end).
 */
export function resolveConversiePeriod(
  period: ConversiePeriod,
  now = new Date()
): ResolvedConversiePeriod {
  const todayYmd = ymdAmsterdam(now);
  const z = toZonedTime(now, AMSTERDAM_TZ);
  let startYmd: string;
  let endYmd = todayYmd;

  switch (period) {
    case "today":
      startYmd = endYmd;
      break;
    case "yesterday":
      endYmd = shiftYmd(todayYmd, -1);
      startYmd = endYmd;
      break;
    case "last_7_days":
      startYmd = shiftYmd(endYmd, -6);
      break;
    case "last_14_days":
      startYmd = shiftYmd(endYmd, -13);
      break;
    case "last_30_days":
      startYmd = shiftYmd(endYmd, -29);
      break;
    case "this_quarter":
      startYmd = ymdAmsterdam(startOfQuarter(z));
      break;
    case "this_year":
      startYmd = ymdAmsterdam(startOfYear(z));
      break;
    case "all_time":
      startYmd = "2020-01-01";
      break;
    default:
      startYmd = endYmd;
  }

  if (startYmd > endYmd) startYmd = endYmd;

  return {
    period,
    label: CONVERSIE_PERIOD_LABELS[period],
    startYmd,
    endYmd,
    days: daysInclusive(startYmd, endYmd),
  };
}

export function todayConversieYmd(now = new Date()): string {
  return ymdAmsterdam(now);
}

/** ISO-week (ma–zo) die `ymd` bevat. */
export function conversieWeekRangeContaining(ymd: string): {
  startYmd: string;
  endYmd: string;
} {
  const noon = noonAmsterdamFromYmd(ymd);
  const info = schouwWeekFromDate(noon);
  const startYmd = String(
    schouwWeekToMondayIso(info.jaar, info.week)
  ).slice(0, 10);
  return { startYmd, endYmd: shiftYmd(startYmd, 6) };
}

/** Kalendermaand (1e–laatste dag) die `ymd` bevat. */
export function conversieMonthRangeContaining(ymd: string): {
  startYmd: string;
  endYmd: string;
} {
  const z = toZonedTime(noonAmsterdamFromYmd(ymd), AMSTERDAM_TZ);
  const y = z.getFullYear();
  const m = z.getMonth();
  const startYmd = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const endYmd = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { startYmd, endYmd };
}

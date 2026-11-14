import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";

export type DateRange = { from: string; to: string };

export type PresetId =
  | "vandaag"
  | "gisteren"
  | "deze_week"
  | "vorige_week"
  | "deze_maand"
  | "vorige_maand"
  | "d30"
  | "d90"
  | "dit_jaar"
  | "vrij";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(value: string | null | undefined): value is string {
  return Boolean(value && YMD.test(value));
}

export function todayYmd(now = new Date()): string {
  return formatInTimeZone(now, AMSTERDAM_TZ, "yyyy-MM-dd");
}

/** Kalenderdag schuiven via het middaguur in Amsterdam (zomertijd/wintertijd). */
export function addYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0), AMSTERDAM_TZ);
  return formatInTimeZone(addDays(noon, days), AMSTERDAM_TZ, "yyyy-MM-dd");
}

export function daysInclusive(from: string, to: string): number {
  if (from > to) return 0;
  let n = 1;
  let cur = from;
  while (cur < to) {
    cur = addYmd(cur, 1);
    n += 1;
    if (n > 4000) break;
  }
  return n;
}

export function ymdStartIso(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(new Date(y, m - 1, d, 0, 0, 0, 0), AMSTERDAM_TZ).toISOString();
}

/** Einde van de lokale dag, inclusief 23:59:59.999 Amsterdam. */
export function ymdEndIso(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(
    new Date(y, m - 1, d, 23, 59, 59, 999),
    AMSTERDAM_TZ
  ).toISOString();
}

export function ymdInRange(ymd: string | null | undefined, range: DateRange): boolean {
  if (!ymd || !isYmd(ymd)) return false;
  return ymd >= range.from && ymd <= range.to;
}

export function isoToYmd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

/** Alleen een kalenderdatum (yyyy-MM-dd), geen tijdstip en geen updated_at. */
export function dateOnlyYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const head = value.trim().slice(0, 10);
  if (isYmd(head)) return head;
  return isoToYmd(value);
}

export function shiftYear(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const targetYear = y + delta;
  const last = new Date(targetYear, m, 0).getDate();
  const day = Math.min(d, last);
  return `${targetYear}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function weekRangeContaining(ymd: string): DateRange & { key: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0), AMSTERDAM_TZ);
  const info = schouwWeekFromDate(noon);
  try {
    const monday = isoToYmd(schouwWeekToMondayIso(info.jaar, info.week));
    if (!monday) throw new Error("geen maandag");
    return {
      from: monday,
      to: addYmd(monday, 6),
      key: schouwWeekValue(info.jaar, info.week),
    };
  } catch {
    return { from: ymd, to: ymd, key: ymd };
  }
}

export function monthRangeContaining(ymd: string): DateRange {
  const [y, m] = ymd.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

export function presetRange(preset: PresetId, now = new Date()): DateRange {
  const today = todayYmd(now);
  if (preset === "vandaag") return { from: today, to: today };
  if (preset === "gisteren") {
    const y = addYmd(today, -1);
    return { from: y, to: y };
  }
  if (preset === "deze_week") {
    const w = weekRangeContaining(today);
    return { from: w.from, to: w.to };
  }
  if (preset === "vorige_week") {
    const w = weekRangeContaining(addYmd(today, -7));
    return { from: w.from, to: w.to };
  }
  if (preset === "deze_maand") return monthRangeContaining(today);
  if (preset === "vorige_maand") {
    const thisMonth = monthRangeContaining(today);
    return monthRangeContaining(addYmd(thisMonth.from, -1));
  }
  if (preset === "d30") return { from: addYmd(today, -29), to: today };
  if (preset === "d90") return { from: addYmd(today, -89), to: today };
  if (preset === "dit_jaar") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: addYmd(today, -29), to: today };
}

export function shiftRange(range: DateRange, direction: -1 | 1): DateRange {
  const len = daysInclusive(range.from, range.to);
  if (direction < 0) {
    const to = addYmd(range.from, -1);
    return { from: addYmd(to, -(len - 1)), to };
  }
  const from = addYmd(range.to, 1);
  return { from, to: addYmd(from, len - 1) };
}

export function previousEqualRange(range: DateRange): DateRange {
  return shiftRange(range, -1);
}

export function sameRangeLastYear(range: DateRange): DateRange {
  return { from: shiftYear(range.from, -1), to: shiftYear(range.to, -1) };
}

export function rangesEqualLength(a: DateRange, b: DateRange): boolean {
  const left = daysInclusive(a.from, a.to);
  return left > 0 && left === daysInclusive(b.from, b.to);
}

export function formatRangeLabel(range: DateRange): string {
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0), AMSTERDAM_TZ);
    return formatInTimeZone(noon, AMSTERDAM_TZ, "d MMM yyyy", { locale: nl });
  };
  if (range.from === range.to) return fmt(range.from);
  return `${fmt(range.from)} – ${fmt(range.to)}`;
}

export type GroupBy = "dag" | "week" | "maand";

export function defaultGroupBy(range: DateRange): GroupBy {
  const days = daysInclusive(range.from, range.to);
  if (days <= 14) return "dag";
  if (days <= 92) return "week";
  return "maand";
}

export function bucketKey(ymd: string, group: GroupBy): string {
  if (group === "dag") return ymd;
  if (group === "week") return weekRangeContaining(ymd).key;
  return ymd.slice(0, 7);
}

export function bucketLabel(key: string, group: GroupBy): string {
  if (group === "week") {
    const m = /^(\d{4})-W(\d{2})$/.exec(key);
    return m ? `W${Number(m[2])}` : key;
  }
  if (group === "maand") {
    const [y, mo] = key.split("-").map(Number);
    const noon = fromZonedTime(new Date(y, mo - 1, 1, 12, 0, 0), AMSTERDAM_TZ);
    return formatInTimeZone(noon, AMSTERDAM_TZ, "MMM yyyy", { locale: nl });
  }
  const [y, m, d] = key.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0), AMSTERDAM_TZ);
  return formatInTimeZone(noon, AMSTERDAM_TZ, "d MMM", { locale: nl });
}

export function listBuckets(range: DateRange, group: GroupBy): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  let cur = range.from;
  let guard = 0;
  while (cur <= range.to && guard < 4000) {
    const key = bucketKey(cur, group);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ key, label: bucketLabel(key, group) });
    }
    cur = addYmd(cur, 1);
    guard += 1;
  }
  return out;
}

export function weekOverlaps(range: DateRange): { key: string; from: string; to: string; partial: boolean }[] {
  const out: { key: string; from: string; to: string; partial: boolean }[] = [];
  let cur = range.from;
  const seen = new Set<string>();
  let guard = 0;
  while (cur <= range.to && guard < 4000) {
    const w = weekRangeContaining(cur);
    if (!seen.has(w.key)) {
      seen.add(w.key);
      const partial = w.from < range.from || w.to > range.to;
      out.push({ key: w.key, from: w.from, to: w.to, partial });
    }
    cur = addYmd(w.to, 1);
    guard += 1;
  }
  return out;
}

export function upcomingWeeks(now = new Date()): { key: string; from: string; to: string; label: string }[] {
  const today = todayYmd(now);
  const current = weekRangeContaining(today);
  const nextFrom = addYmd(current.to, 1);
  const next = weekRangeContaining(nextFrom);
  const after = weekRangeContaining(addYmd(next.to, 1));
  return [
    { ...next, label: "Volgende week" },
    { ...after, label: "Week daarna" },
  ];
}

/**
 * Schouwweken eindigend op de week van `endYmd`, oplopend in tijd.
 * `count` weken inclusief de eindweek.
 */
export function weeksEndingAt(
  endYmd: string,
  count: number
): { key: string; from: string; to: string; label: string }[] {
  const n = Math.max(1, Math.min(52, Math.floor(count)));
  const end = weekRangeContaining(endYmd);
  const out: { key: string; from: string; to: string; label: string }[] = [];
  let cursor = end.from;
  for (let i = 0; i < n; i++) {
    const w = weekRangeContaining(cursor);
    out.unshift({
      key: w.key,
      from: w.from,
      to: w.to,
      label: bucketLabel(w.key, "week"),
    });
    cursor = addYmd(w.from, -7);
  }
  return out;
}

export type TrendPeriodId =
  | "d30"
  | "d90"
  | "deze_maand"
  | "vorige_maand"
  | "w8"
  | "w12"
  | "w26"
  | "dit_jaar"
  | "vrij";

export const TREND_PERIOD_IDS = new Set<TrendPeriodId>([
  "d30",
  "d90",
  "deze_maand",
  "vorige_maand",
  "w8",
  "w12",
  "w26",
  "dit_jaar",
  "vrij",
]);

/** Trendperiode t.o.v. vandaag (Amsterdam ymd). `vrij` valt terug op 30 dagen. */
export function trendPeriodRange(
  id: TrendPeriodId,
  todayYmdValue: string
): DateRange {
  if (id === "vrij") return presetRange("d30");
  if (id === "w8" || id === "w12" || id === "w26") {
    const n = id === "w8" ? 8 : id === "w12" ? 12 : 26;
    const weeks = weeksEndingAt(todayYmdValue, n);
    return { from: weeks[0]!.from, to: weeks[weeks.length - 1]!.to };
  }
  const preset = id as PresetId;
  return presetRange(preset);
}

/** Periodekeuzes voor sales-kwaliteit in de cockpit. */
export type QualityPeriodId =
  | "deze_week"
  | "vorige_week"
  | "deze_maand"
  | "vorige_maand"
  | "d30"
  | "d90"
  | "dit_jaar"
  | "vrij";

export const QUALITY_PERIOD_IDS = new Set<QualityPeriodId>([
  "deze_week",
  "vorige_week",
  "deze_maand",
  "vorige_maand",
  "d30",
  "d90",
  "dit_jaar",
  "vrij",
]);

/** Kwaliteitsperiode t.o.v. vandaag. `vrij` valt terug op 30 dagen. */
export function qualityPeriodRange(
  id: QualityPeriodId,
  _todayYmdValue = todayYmd()
): DateRange {
  if (id === "vrij") return presetRange("d30");
  return presetRange(id);
}

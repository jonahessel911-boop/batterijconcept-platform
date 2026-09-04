import {
  addDays,
  addWeeks,
  endOfISOWeek,
  getISOWeek,
  getISOWeekYear,
  getISOWeeksInYear,
  startOfISOWeek,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ } from "@/lib/format";

export type SchouwWeek = { jaar: number; week: number };

export function parseSchouwWeekValue(
  value: string | null | undefined
): SchouwWeek | null {
  if (!value) return null;
  const m = /^(\d{4})-W(\d{1,2})$/i.exec(value.trim());
  if (!m) return null;
  const jaar = Number(m[1]);
  const week = Number(m[2]);
  if (!isValidSchouwWeek(jaar, week)) return null;
  return { jaar, week };
}

export function schouwWeekValue(jaar: number, week: number): string {
  return `${jaar}-W${String(week).padStart(2, "0")}`;
}

export function isValidSchouwWeek(jaar: number, week: number): boolean {
  if (!Number.isInteger(jaar) || jaar < 2000 || jaar > 2100) return false;
  if (!Number.isInteger(week) || week < 1) return false;
  const max = getISOWeeksInYear(new Date(jaar, 5, 1));
  return week <= max;
}

/** Maandag (lokaal) van de ISO-week; daarna als Amsterdam-middag → ISO. */
export function schouwWeekToMondayIso(jaar: number, week: number): string {
  if (!isValidSchouwWeek(jaar, week)) {
    throw new Error("Ongeldige schouwweek");
  }
  // 4 jan valt altijd in ISO-week 1 van dat jaar
  const jan4 = fromZonedTime(new Date(jaar, 0, 4, 12, 0, 0), AMSTERDAM_TZ);
  const zoned = toZonedTime(jan4, AMSTERDAM_TZ);
  const week1Monday = startOfISOWeek(zoned);
  const monday = addWeeks(week1Monday, week - 1);
  const y = monday.getFullYear();
  const m = monday.getMonth();
  const d = monday.getDate();
  return fromZonedTime(new Date(y, m, d, 12, 0, 0), AMSTERDAM_TZ).toISOString();
}

export function schouwWeekFromDate(date: Date | string): SchouwWeek {
  const d = typeof date === "string" ? new Date(date) : date;
  const zoned = toZonedTime(d, AMSTERDAM_TZ);
  return {
    jaar: getISOWeekYear(zoned),
    week: getISOWeek(zoned),
  };
}

export function formatSchouwWeekLabel(jaar: number, week: number): string {
  const mondayIso = schouwWeekToMondayIso(jaar, week);
  const monday = toZonedTime(new Date(mondayIso), AMSTERDAM_TZ);
  const sunday = endOfISOWeek(monday);
  const range = `${formatInTimeZone(monday, AMSTERDAM_TZ, "d MMM", { locale: nl })} – ${formatInTimeZone(sunday, AMSTERDAM_TZ, "d MMM yyyy", { locale: nl })}`;
  return `Week ${week} · ${range}`;
}

export function formatProjectSchouwWeek(project: {
  schouw_jaar?: number | null;
  schouw_week?: number | null;
  schouw_at?: string | null;
}): string | null {
  if (project.schouw_jaar && project.schouw_week) {
    return formatSchouwWeekLabel(project.schouw_jaar, project.schouw_week);
  }
  if (project.schouw_at) {
    const { jaar, week } = schouwWeekFromDate(project.schouw_at);
    return formatSchouwWeekLabel(jaar, week);
  }
  return null;
}

/** Schouwweek staat gepland (week of placeholder-maandag). */
export function isSchouwweekGepland(project: {
  schouw_jaar?: number | null;
  schouw_week?: number | null;
  schouw_at?: string | null;
}): boolean {
  return Boolean(
    project.schouw_week || project.schouw_jaar || project.schouw_at
  );
}

/**
 * Exacte schouwdag/tijd is gezet (niet alleen de week-placeholder op maandag 12:00).
 */
export function isSchouwdagDefinitief(project: {
  schouw_jaar?: number | null;
  schouw_week?: number | null;
  schouw_at?: string | null;
}): boolean {
  if (!project.schouw_at) return false;
  if (!project.schouw_jaar || !project.schouw_week) return true;
  try {
    const mondayIso = schouwWeekToMondayIso(
      project.schouw_jaar,
      project.schouw_week
    );
    return (
      new Date(project.schouw_at).getTime() !== new Date(mondayIso).getTime()
    );
  } catch {
    return true;
  }
}

/** Warmtefonds: ~5 weken vooruit (tijd voor aanvraag). Eigen middelen: z.s.m. */
export const SCHOUW_WEEK_OFFSET_WARMTEFONDS = 5;
export const SCHOUW_WEEK_OFFSET_EIGEN = 1;

/** Standaard schouwweek: sale-/huidige moment + N ISO-weken. */
export function defaultSchouwWeekAfterSale(
  from: Date | string = new Date(),
  offsetWeeks = SCHOUW_WEEK_OFFSET_WARMTEFONDS
): SchouwWeek {
  const base = typeof from === "string" ? new Date(from) : from;
  return schouwWeekFromDate(addWeeks(base, offsetWeeks));
}

export function schouwWeekOffsetVoorSale(warmtefonds: boolean): number {
  return warmtefonds
    ? SCHOUW_WEEK_OFFSET_WARMTEFONDS
    : SCHOUW_WEEK_OFFSET_EIGEN;
}

/** Opties vanaf huidige ISO-week, `count` weken vooruit. */
export function upcomingSchouwWeekOptions(
  count = 60,
  from: Date = new Date()
): { value: string; label: string; jaar: number; week: number }[] {
  const start = schouwWeekFromDate(from);
  const out: { value: string; label: string; jaar: number; week: number }[] =
    [];
  let jaar = start.jaar;
  let week = start.week;
  for (let i = 0; i < count; i++) {
    out.push({
      value: schouwWeekValue(jaar, week),
      label: formatSchouwWeekLabel(jaar, week),
      jaar,
      week,
    });
    const max = getISOWeeksInYear(new Date(jaar, 5, 1));
    week += 1;
    if (week > max) {
      week = 1;
      jaar += 1;
    }
  }
  return out;
}

/** Weekkiezer voor agenda: `past` weken terug + `future` vooruit. */
export function agendaWeekJumpOptions(
  past = 8,
  future = 52,
  from: Date = new Date()
): { value: string; label: string; jaar: number; week: number }[] {
  return upcomingSchouwWeekOptions(past + future, addWeeks(from, -past));
}

/**
 * True als `now` (Amsterdam) exact 7 dagen vóór de maandag van de schouwweek valt
 * — moment om contact op te nemen voor exacte datum/tijd.
 */
export function isOneWeekBeforeSchouwWeek(
  jaar: number,
  week: number,
  now: Date = new Date()
): boolean {
  const mondayIso = schouwWeekToMondayIso(jaar, week);
  const mondayKey = formatInTimeZone(
    new Date(mondayIso),
    AMSTERDAM_TZ,
    "yyyy-MM-dd"
  );
  const nowZoned = toZonedTime(now, AMSTERDAM_TZ);
  const targetKey = formatInTimeZone(
    addDays(nowZoned, 7),
    AMSTERDAM_TZ,
    "yyyy-MM-dd"
  );
  return mondayKey === targetKey;
}

/**
 * Schouwdag plannen: vanaf 7 dagen vóór de schouwweek-maandag tot einde van die week.
 */
export function isInSchouwdagPlannenWindow(
  jaar: number,
  week: number,
  now: Date = new Date()
): boolean {
  const mondayIso = schouwWeekToMondayIso(jaar, week);
  const monday = toZonedTime(new Date(mondayIso), AMSTERDAM_TZ);
  const sunday = endOfISOWeek(monday);
  const nowZ = toZonedTime(now, AMSTERDAM_TZ);
  const windowStart = addDays(monday, -7);
  return nowZ >= windowStart && nowZ <= sunday;
}

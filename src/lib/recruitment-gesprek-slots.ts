/**
 * 30-minuten slots voor sollicitatiegesprekken (werkdag 09:00–17:30).
 */

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export const GESPREK_DUUR_MIN = 30;
/** Eerste slot-start. */
export const GESPREK_DAG_START_HOUR = 9;
/** Laatste slot-start (17:00 → eindigt 17:30). */
export const GESPREK_DAG_LAATSTE_START_HOUR = 17;
export const GESPREK_DAG_LAATSTE_START_MIN = 0;

export type GesprekSlot = {
  startAt: string;
  endAt: string;
  label: string;
  busy: boolean;
};

export function amsterdamYmd(d: Date | string = new Date()): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

export function slotRangeForDay(dayYmd: string): { start: Date; end: Date } {
  const [y, m, d] = dayYmd.split("-").map(Number);
  const start = fromZonedTime(
    new Date(y, m - 1, d, GESPREK_DAG_START_HOUR, 0, 0, 0),
    AMSTERDAM_TZ
  );
  const end = fromZonedTime(
    new Date(
      y,
      m - 1,
      d,
      GESPREK_DAG_LAATSTE_START_HOUR,
      GESPREK_DAG_LAATSTE_START_MIN + GESPREK_DUUR_MIN,
      0,
      0
    ),
    AMSTERDAM_TZ
  );
  return { start, end };
}

export function buildGesprekSlots(opts: {
  dayYmd: string;
  busyRanges: Array<{ start_at: string; end_at?: string | null }>;
  /** Skip slots die al begonnen zijn (alleen vandaag). */
  now?: Date;
}): GesprekSlot[] {
  const [y, m, d] = opts.dayYmd.split("-").map(Number);
  const now = opts.now || new Date();
  const todayYmd = amsterdamYmd(now);
  const slots: GesprekSlot[] = [];

  for (
    let mins = GESPREK_DAG_START_HOUR * 60;
    mins <= GESPREK_DAG_LAATSTE_START_HOUR * 60 + GESPREK_DAG_LAATSTE_START_MIN;
    mins += GESPREK_DUUR_MIN
  ) {
    const h = Math.floor(mins / 60);
    const min = mins % 60;
    const start = fromZonedTime(
      new Date(y, m - 1, d, h, min, 0, 0),
      AMSTERDAM_TZ
    );
    const end = new Date(start.getTime() + GESPREK_DUUR_MIN * 60_000);
    if (opts.dayYmd === todayYmd && start.getTime() <= now.getTime()) {
      continue;
    }
    const busy = opts.busyRanges.some((r) => {
      const a0 = new Date(r.start_at).getTime();
      const a1 = new Date(
        r.end_at || a0 + GESPREK_DUUR_MIN * 60_000
      ).getTime();
      return a0 < end.getTime() && a1 > start.getTime();
    });
    slots.push({
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      label: formatInTimeZone(start, AMSTERDAM_TZ, "HH:mm"),
      busy,
    });
  }
  return slots;
}

/** Komende N werkdagen (ma–vr) als yyyy-MM-dd. */
export function upcomingWorkdays(count: number, from = new Date()): string[] {
  const out: string[] = [];
  const cursor = new Date(from.getTime());
  // Start vandaag (Amsterdam)
  let guard = 0;
  while (out.length < count && guard < 40) {
    guard += 1;
    const ymd = amsterdamYmd(cursor);
    const [y, m, d] = ymd.split("-").map(Number);
    const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
    const dow = Number(formatInTimeZone(noon, AMSTERDAM_TZ, "i")); // 1=ma … 7=zo
    if (dow <= 5) out.push(ymd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

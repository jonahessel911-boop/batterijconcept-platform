/**
 * Live-rapportage: cohort L→A op leads die recent binnenkwamen,
 * plus wanneer die leads zijn ingepland (afspraak.created_at).
 * Geen credit voor oude leads die nu pas een afspraak krijgen.
 */

import { addDays } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  amsDayBounds,
  leadToApptPct,
  todayAmsterdamYmd,
} from "@/lib/lead-conversie";
import { dayKeyAmsterdam } from "@/lib/adviseur-beschikbaarheid";

export const LIVE_DAY_OPTIONS = [1, 3, 7] as const;
export type LiveDays = (typeof LIVE_DAY_OPTIONS)[number];

export type LiveLeadRow = {
  id: string;
  naam: string;
  plaats: string | null;
  bron: string | null;
  status: string | null;
  /** Wanneer de lead binnenkwam */
  created_at: string;
  created_ymd: string;
  /** Eerste huisbezoek-ingpland-moment (afspraak.created_at), of null */
  ingepland_at: string | null;
  ingepland_ymd: string | null;
  /** Bezoekmoment (afspraak.start_at) */
  afspraak_start_at: string | null;
  /** Uren tussen binnenkomst en inplannen */
  uren_tot_ingepland: number | null;
};

export type LiveDayBucket = {
  ymd: string;
  label: string;
  leads: number;
  ingepland: number;
  /** Open (niet ingepland) met status geen_contact / vervolg_geen_contact */
  geenContact: number;
  /** Open met status nieuw */
  nieuwOpen: number;
  leadToAppt: number | null;
};

export type LiveRapportageResult = {
  days: LiveDays;
  todayYmd: string;
  rangeStartYmd: string;
  rangeEndYmd: string;
  leads: number;
  ingepland: number;
  open: number;
  /** Open + status geen_contact / vervolg_geen_contact */
  geenContact: number;
  /** Open + status nieuw (nog niet / nauwelijks bewerkt) */
  nieuwOpen: number;
  leadToAppt: number | null;
  /** Gemiddelde uren tot inplannen (alleen voor ingeplande leads) */
  avgUrenTotIngepland: number | null;
  byDay: LiveDayBucket[];
  rows: LiveLeadRow[];
};

/** Status die in belbak als “geen contact” telt. */
export function isLiveGeenContactStatus(
  status: string | null | undefined
): boolean {
  return status === "geen_contact" || status === "vervolg_geen_contact";
}

export function isLiveOpenRow(row: Pick<LiveLeadRow, "ingepland_at">): boolean {
  return !row.ingepland_at;
}

export function parseLiveDays(raw: string | null): LiveDays {
  const n = Number(raw);
  if (n === 1 || n === 3 || n === 7) return n;
  return 3;
}

export function shiftAmsterdamYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
  return dayKeyAmsterdam(addDays(noon, deltaDays));
}

export function liveRangeYmd(
  days: LiveDays,
  todayYmd = todayAmsterdamYmd()
): { startYmd: string; endYmd: string } {
  const endYmd = todayYmd;
  const startYmd = shiftAmsterdamYmd(todayYmd, -(days - 1));
  return { startYmd, endYmd };
}

export function liveDayLabel(ymd: string, todayYmd: string): string {
  if (ymd === todayYmd) return "Vandaag";
  const yesterday = shiftAmsterdamYmd(todayYmd, -1);
  if (ymd === yesterday) return "Gisteren";
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
  return noon.toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: AMSTERDAM_TZ,
  });
}

export function hoursBetween(
  fromIso: string,
  toIso: string
): number | null {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round(((b - a) / 3_600_000) * 10) / 10;
}

export function buildLiveDayBuckets(
  rows: LiveLeadRow[],
  startYmd: string,
  endYmd: string,
  todayYmd: string
): LiveDayBucket[] {
  const buckets: LiveDayBucket[] = [];
  let cursor = startYmd;
  while (cursor <= endYmd) {
    const dayRows = rows.filter((r) => r.created_ymd === cursor);
    const leads = dayRows.length;
    const ingepland = dayRows.filter((r) => r.ingepland_at).length;
    const openRows = dayRows.filter(isLiveOpenRow);
    buckets.push({
      ymd: cursor,
      label: liveDayLabel(cursor, todayYmd),
      leads,
      ingepland,
      geenContact: openRows.filter((r) =>
        isLiveGeenContactStatus(r.status)
      ).length,
      nieuwOpen: openRows.filter((r) => r.status === "nieuw").length,
      leadToAppt: leadToApptPct(ingepland, leads),
    });
    if (cursor === endYmd) break;
    cursor = shiftAmsterdamYmd(cursor, 1);
  }
  return buckets;
}

export function summarizeLiveRows(
  rows: LiveLeadRow[],
  days: LiveDays,
  todayYmd: string,
  startYmd: string,
  endYmd: string
): LiveRapportageResult {
  const leads = rows.length;
  const ingepland = rows.filter((r) => r.ingepland_at).length;
  const openRows = rows.filter(isLiveOpenRow);
  const geenContact = openRows.filter((r) =>
    isLiveGeenContactStatus(r.status)
  ).length;
  const nieuwOpen = openRows.filter((r) => r.status === "nieuw").length;
  const hours = rows
    .map((r) => r.uren_tot_ingepland)
    .filter((h): h is number => h != null && Number.isFinite(h));
  const avgUrenTotIngepland =
    hours.length > 0
      ? Math.round(
          (hours.reduce((s, h) => s + h, 0) / hours.length) * 10
        ) / 10
      : null;

  return {
    days,
    todayYmd,
    rangeStartYmd: startYmd,
    rangeEndYmd: endYmd,
    leads,
    ingepland,
    open: Math.max(0, leads - ingepland),
    geenContact,
    nieuwOpen,
    leadToAppt: leadToApptPct(ingepland, leads),
    avgUrenTotIngepland,
    byDay: buildLiveDayBuckets(rows, startYmd, endYmd, todayYmd),
    rows,
  };
}

/** Expose bounds helper for the API route. */
export { amsDayBounds };

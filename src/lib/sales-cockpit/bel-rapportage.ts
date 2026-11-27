/**
 * Sales Cockpit — Bel rapportage: vandaag / week / maand + vorige periode
 * en dagelijkse series voor area-charts.
 */

import {
  buildBelMetricsForRange,
  type BelMetrics,
} from "@/lib/bel-rapportage";
import {
  countLateUitval,
  countVroegeUitval,
  LATE_UITVAL_WINDOW_DEFS,
  VROEGE_UITVAL_WINDOW_DEFS,
  type BelConversieAfspraak,
  type BelConversieLead,
  type LateUitvalWindowKey,
  type VroegeUitvalWindowKey,
} from "@/lib/bel-conversie";
import {
  addYmd,
  bucketKey,
  bucketLabel,
  daysInclusive,
  formatRangeLabel,
  listBuckets,
  monthRangeContaining,
  previousEqualRange,
  todayYmd,
  weekRangeContaining,
  ymdEndIso,
  ymdStartIso,
  type DateRange,
  type GroupBy,
} from "@/lib/sales-cockpit/range";
import { round2, safeDiv } from "@/lib/management-dashboard/periods";
import { normalizeRol } from "@/lib/rollen";

export type BelKpiKey =
  | "gebeld"
  | "ingepland"
  | "geenInteresse"
  | "geenContact";

export type BelKpiPeriodId = "vorige_maand" | "vandaag" | "week" | "maand";
export type BelLeaderboardPeriodId = "vandaag" | "week" | "maand";

/** Vroege-uitvalvensters (na inplannen) in de trendgrafiek. */
export const BEL_TREND_UITVAL_WINDOWS = [
  "h3",
  "d3",
  "d7",
] as const satisfies readonly VroegeUitvalWindowKey[];

/** Last-minute uitval (vóór bezoek) in de trendgrafiek. */
export const BEL_TREND_LATE_UITVAL_WINDOWS = [
  "before3u",
  "before24u",
] as const satisfies readonly LateUitvalWindowKey[];

export type BelPeriodSnapshot = {
  id: BelKpiPeriodId;
  label: string;
  compareLabel: string;
  range: DateRange;
  previousRange: DateRange;
  current: BelMetrics;
  previous: BelMetrics;
  /** % t.o.v. vorige periode per KPI (null = geen basis). */
  deltaPct: Record<BelKpiKey, number | null>;
};

export type BelSeriesPoint = {
  key: string;
  label: string;
  gebeld: number;
  ingepland: number;
  geenInteresse: number;
  geenContact: number;
  /** Vroege uitval 3u — tellers voor % na aggregatie. */
  uitvalH3Geannuleerd: number;
  uitvalH3Rijp: number;
  /** Vroege uitval 3d. */
  uitvalD3Geannuleerd: number;
  uitvalD3Rijp: number;
  /** Vroege uitval 7d. */
  uitvalD7Geannuleerd: number;
  uitvalD7Rijp: number;
  /** Last-minute 3u vóór bezoek (cohort op start_at). */
  lateUitval3uGeannuleerd: number;
  lateUitval3uRijp: number;
  /** Last-minute 24u vóór bezoek. */
  lateUitval24uGeannuleerd: number;
  lateUitval24uRijp: number;
};

export type BelLeaderboardRow = {
  id: string;
  naam: string;
  gebeld: number;
  ingepland: number;
  geenInteresse: number;
  geenContact: number;
  bereikt: number;
  nietBereikt: number;
  convGebeldIngepland: number | null;
  convBereiktIngepland: number | null;
  convBereiktNegatief: number | null;
  convGebeldNietBereikt: number | null;
};

export type BelCockpitOverview = {
  todayYmd: string;
  periods: BelPeriodSnapshot[];
  /**
   * Dagelijkse punten voor trendgrafiek (ruime historie, t/m vandaag).
   * Client filtert/aggregeert per gekozen periode.
   */
  series: BelSeriesPoint[];
  seriesFrom: string;
  seriesTo: string;
  /** Leaderboard per KPI-periode (vandaag / week / maand). */
  leaderboards: Record<BelLeaderboardPeriodId, BelLeaderboardRow[]>;
};

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) {
    if (current <= 0) return 0;
    return null;
  }
  return round2(((current - previous) / previous) * 100);
}

function deltas(current: BelMetrics, previous: BelMetrics) {
  return {
    gebeld: pctChange(current.gebeld, previous.gebeld),
    ingepland: pctChange(current.ingepland, previous.ingepland),
    geenInteresse: pctChange(current.geenInteresse, previous.geenInteresse),
    geenContact: pctChange(current.geenContact, previous.geenContact),
  } satisfies Record<BelKpiKey, number | null>;
}

function shortDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d}/${m}`;
}

type BuildInput = {
  leads: BelConversieLead[];
  afspraken: BelConversieAfspraak[];
  huisbezoekHistorie?: BelConversieAfspraak[];
  adviseurs: {
    id: string;
    naam: string;
    rol?: string | null;
    actief?: boolean;
    email?: string | null;
  }[];
  now?: Date;
};

function metricsFor(
  range: DateRange,
  input: BuildInput,
  bellerId?: string | null
): BelMetrics {
  return buildBelMetricsForRange({
    startYmd: range.from,
    endYmd: range.to,
    leads: input.leads,
    afspraken: input.afspraken,
    huisbezoekHistorie: input.huisbezoekHistorie,
    adviseurs: input.adviseurs,
    bellerId,
  });
}

function pctOf(value: number, base: number): number | null {
  const r = safeDiv(value, base);
  return r == null ? null : round2(r * 100);
}

function leaderboardRowFromMetrics(
  id: string,
  naam: string,
  m: Pick<
    BelMetrics,
    "gebeld" | "ingepland" | "geenInteresse" | "geenContact"
  >
): BelLeaderboardRow {
  const bereikt = m.ingepland + m.geenInteresse;
  const nietBereikt = Math.max(0, m.gebeld - bereikt);
  return {
    id,
    naam,
    gebeld: m.gebeld,
    ingepland: m.ingepland,
    geenInteresse: m.geenInteresse,
    geenContact: m.geenContact,
    bereikt,
    nietBereikt,
    convGebeldIngepland: pctOf(m.ingepland, m.gebeld),
    convBereiktIngepland: pctOf(m.ingepland, bereikt),
    convBereiktNegatief: pctOf(m.geenInteresse, bereikt),
    convGebeldNietBereikt: pctOf(nietBereikt, m.gebeld),
  };
}

/** Actieve bellers (+ Onbekend bij restactiviteit) voor een periode. */
export function buildBelLeaderboard(
  range: DateRange,
  input: BuildInput
): BelLeaderboardRow[] {
  const bellers = input.adviseurs.filter((a) => {
    const rol = normalizeRol(a.rol);
    return a.actief !== false && (rol === "beller" || rol === "backoffice");
  });

  const attributed = new Map<string, BelMetrics>();
  for (const b of bellers) {
    attributed.set(b.id, metricsFor(range, input, b.id));
  }
  const total = metricsFor(range, input);
  const sumAttr = [...attributed.values()].reduce(
    (s, m) => ({
      gebeld: s.gebeld + m.gebeld,
      ingepland: s.ingepland + m.ingepland,
      geenInteresse: s.geenInteresse + m.geenInteresse,
      geenContact: s.geenContact + m.geenContact,
    }),
    { gebeld: 0, ingepland: 0, geenInteresse: 0, geenContact: 0 }
  );

  const rows: BelLeaderboardRow[] = bellers.map((b) =>
    leaderboardRowFromMetrics(b.id, b.naam, attributed.get(b.id)!)
  );

  const unknown = leaderboardRowFromMetrics("__onbekend__", "Onbekend", {
    gebeld: Math.max(0, total.gebeld - sumAttr.gebeld),
    ingepland: Math.max(0, total.ingepland - sumAttr.ingepland),
    geenInteresse: Math.max(0, total.geenInteresse - sumAttr.geenInteresse),
    geenContact: Math.max(0, total.geenContact - sumAttr.geenContact),
  });
  if (unknown.gebeld > 0 || unknown.ingepland > 0) {
    rows.push(unknown);
  }

  return rows.sort(
    (a, b) =>
      b.ingepland - a.ingepland ||
      b.gebeld - a.gebeld ||
      a.naam.localeCompare(b.naam, "nl")
  );
}

/** MTD → zelfde aantal dagen in vorige kalendermaand. */
function previousMonthToDate(range: DateRange): DateRange {
  const prevMonth = monthRangeContaining(addYmd(range.from, -1));
  const len = daysInclusive(range.from, range.to);
  const to = addYmd(prevMonth.from, len - 1);
  return {
    from: prevMonth.from,
    to: to > prevMonth.to ? prevMonth.to : to,
  };
}

function periodSnapshot(
  id: BelKpiPeriodId,
  label: string,
  compareLabel: string,
  range: DateRange,
  previousRange: DateRange,
  input: BuildInput
): BelPeriodSnapshot {
  const current = metricsFor(range, input);
  const previous = metricsFor(previousRange, input);
  return {
    id,
    label,
    compareLabel,
    range,
    previousRange,
    current,
    previous,
    deltaPct: deltas(current, previous),
  };
}

function leadStatusMap(
  leads: BelConversieLead[]
): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const l of leads) m.set(l.id, l.status ?? null);
  return m;
}

function emptyUitvalFields(): Pick<
  BelSeriesPoint,
  | "uitvalH3Geannuleerd"
  | "uitvalH3Rijp"
  | "uitvalD3Geannuleerd"
  | "uitvalD3Rijp"
  | "uitvalD7Geannuleerd"
  | "uitvalD7Rijp"
  | "lateUitval3uGeannuleerd"
  | "lateUitval3uRijp"
  | "lateUitval24uGeannuleerd"
  | "lateUitval24uRijp"
> {
  return {
    uitvalH3Geannuleerd: 0,
    uitvalH3Rijp: 0,
    uitvalD3Geannuleerd: 0,
    uitvalD3Rijp: 0,
    uitvalD7Geannuleerd: 0,
    uitvalD7Rijp: 0,
    lateUitval3uGeannuleerd: 0,
    lateUitval3uRijp: 0,
    lateUitval24uGeannuleerd: 0,
    lateUitval24uRijp: 0,
  };
}

function dayUitvalFields(
  dayYmd: string,
  input: BuildInput,
  now: Date
): ReturnType<typeof emptyUitvalFields> {
  const start = new Date(ymdStartIso(dayYmd));
  const end = new Date(ymdEndIso(dayYmd));
  const statuses = leadStatusMap(input.leads);
  const out = emptyUitvalFields();
  for (const key of BEL_TREND_UITVAL_WINDOWS) {
    const def = VROEGE_UITVAL_WINDOW_DEFS[key];
    const counts = countVroegeUitval({
      afspraken: input.afspraken,
      historie: input.huisbezoekHistorie,
      start,
      end,
      withinHours: def.hours,
      now,
      leadStatusById: statuses,
    });
    if (key === "h3") {
      out.uitvalH3Geannuleerd = counts.geannuleerdVroeg;
      out.uitvalH3Rijp = counts.geplaatstRijp;
    } else if (key === "d3") {
      out.uitvalD3Geannuleerd = counts.geannuleerdVroeg;
      out.uitvalD3Rijp = counts.geplaatstRijp;
    } else {
      out.uitvalD7Geannuleerd = counts.geannuleerdVroeg;
      out.uitvalD7Rijp = counts.geplaatstRijp;
    }
  }
  for (const key of BEL_TREND_LATE_UITVAL_WINDOWS) {
    const def = LATE_UITVAL_WINDOW_DEFS[key];
    const counts = countLateUitval({
      afspraken: input.afspraken,
      historie: input.huisbezoekHistorie,
      start,
      end,
      withinHoursBeforeStart: def.hours,
      now,
      leadStatusById: statuses,
    });
    if (key === "before3u") {
      out.lateUitval3uGeannuleerd = counts.geannuleerdLaat;
      out.lateUitval3uRijp = counts.geplandRijp;
    } else {
      out.lateUitval24uGeannuleerd = counts.geannuleerdLaat;
      out.lateUitval24uRijp = counts.geplandRijp;
    }
  }
  return out;
}

export function buildBelCockpitOverview(input: BuildInput): BelCockpitOverview {
  const today = todayYmd(input.now);
  const dayRange: DateRange = { from: today, to: today };
  const week = weekRangeContaining(today);
  const weekRange: DateRange = { from: week.from, to: week.to };
  const month = monthRangeContaining(today);
  // Maand telt t/m vandaag (niet toekomstige dagen van de maand).
  const monthRange: DateRange = {
    from: month.from,
    to: today < month.to ? today : month.to,
  };
  const prevMonthRange = monthRangeContaining(addYmd(month.from, -1));
  const prevPrevMonthRange = monthRangeContaining(
    addYmd(prevMonthRange.from, -1)
  );

  const periods: BelPeriodSnapshot[] = [
    periodSnapshot(
      "vandaag",
      "Vandaag",
      "vs gisteren",
      dayRange,
      previousEqualRange(dayRange),
      input
    ),
    periodSnapshot(
      "week",
      "Deze week",
      "vs vorige week",
      weekRange,
      previousEqualRange(weekRange),
      input
    ),
    periodSnapshot(
      "maand",
      "Deze maand",
      "vs vorige maand (zelfde dagen)",
      monthRange,
      previousMonthToDate(monthRange),
      input
    ),
    periodSnapshot(
      "vorige_maand",
      "Vorige maand",
      "vs maand ervoor",
      prevMonthRange,
      prevPrevMonthRange,
      input
    ),
  ];

  // Ruim genoeg voor cockpit-gelijke periodes (w26 + dit jaar).
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const w26From = addYmd(today, -(26 * 7 + 6));
  const seriesFrom = yearStart < w26From ? yearStart : w26From;
  const seriesTo = today;
  const now = input.now ?? new Date();
  const series: BelSeriesPoint[] = [];
  let cursor = seriesFrom;
  while (cursor <= seriesTo) {
    const day = metricsFor({ from: cursor, to: cursor }, input);
    series.push({
      key: cursor,
      label: shortDayLabel(cursor),
      gebeld: day.gebeld,
      ingepland: day.ingepland,
      geenInteresse: day.geenInteresse,
      geenContact: day.geenContact,
      ...dayUitvalFields(cursor, input, now),
    });
    cursor = addYmd(cursor, 1);
  }

  const leaderboards: BelCockpitOverview["leaderboards"] = {
    vandaag: buildBelLeaderboard(dayRange, input),
    week: buildBelLeaderboard(weekRange, input),
    maand: buildBelLeaderboard(monthRange, input),
  };

  return {
    todayYmd: today,
    periods,
    series,
    seriesFrom,
    seriesTo,
    leaderboards,
  };
}

/** Filter + optioneel aggregeren (dag/week/maand) voor de trendgrafiek. */
export function buildBelTrendSeries(
  daily: BelSeriesPoint[],
  range: DateRange,
  group: GroupBy
): BelSeriesPoint[] {
  const inRange = daily.filter((p) => p.key >= range.from && p.key <= range.to);
  if (group === "dag") return inRange;

  const buckets = listBuckets(range, group);
  return buckets.map((b) => {
    const rows = inRange.filter((p) => bucketKey(p.key, group) === b.key);
    return {
      key: b.key,
      label: b.label || bucketLabel(b.key, group),
      gebeld: rows.reduce((s, r) => s + r.gebeld, 0),
      ingepland: rows.reduce((s, r) => s + r.ingepland, 0),
      geenInteresse: rows.reduce((s, r) => s + r.geenInteresse, 0),
      geenContact: rows.reduce((s, r) => s + r.geenContact, 0),
      uitvalH3Geannuleerd: rows.reduce((s, r) => s + r.uitvalH3Geannuleerd, 0),
      uitvalH3Rijp: rows.reduce((s, r) => s + r.uitvalH3Rijp, 0),
      uitvalD3Geannuleerd: rows.reduce((s, r) => s + r.uitvalD3Geannuleerd, 0),
      uitvalD3Rijp: rows.reduce((s, r) => s + r.uitvalD3Rijp, 0),
      uitvalD7Geannuleerd: rows.reduce((s, r) => s + r.uitvalD7Geannuleerd, 0),
      uitvalD7Rijp: rows.reduce((s, r) => s + r.uitvalD7Rijp, 0),
      lateUitval3uGeannuleerd: rows.reduce(
        (s, r) => s + r.lateUitval3uGeannuleerd,
        0
      ),
      lateUitval3uRijp: rows.reduce((s, r) => s + r.lateUitval3uRijp, 0),
      lateUitval24uGeannuleerd: rows.reduce(
        (s, r) => s + r.lateUitval24uGeannuleerd,
        0
      ),
      lateUitval24uRijp: rows.reduce((s, r) => s + r.lateUitval24uRijp, 0),
    };
  });
}

export function belDeltaCopy(deltaPct: number | null): string | null {
  if (deltaPct == null) return "nieuw";
  if (deltaPct === 0) return "gelijk";
  const abs = Math.abs(deltaPct).toLocaleString("nl-NL", {
    maximumFractionDigits: 0,
  });
  return deltaPct > 0 ? `${abs}% gestegen` : `${abs}% gedaald`;
}

export function belPeriodRangeHint(period: BelPeriodSnapshot): string {
  return `${formatRangeLabel(period.range)} · ${period.compareLabel} (${formatRangeLabel(period.previousRange)})`;
}

/** Conversie gebeld → ingepland voor snelle KPI-subregel. */
export function belIngeplandPct(m: BelMetrics): number | null {
  const r = safeDiv(m.ingepland, m.gebeld);
  return r == null ? null : round2(r * 100);
}

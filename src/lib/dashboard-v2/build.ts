/**
 * Dashboard v2 — tijdreeks KPI's met staafdiagram-buckets.
 * Omzet/orders = getekende offertes op ondertekend_op (niet offerte- of lead-created_at).
 * Lead→afspraak = eerste nieuw-afspraak per lead / leads in de bucket.
 */

import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  getISOWeek,
  getISOWeekYear,
  startOfMonth,
  subMonths,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { afspraakBlokkeertAgenda, isAfgeboekteFysiekeAfspraak, normalizeAfspraakSoort } from "@/lib/afspraak-soort";
import { deltaPct, inIsoRange, round2, safeDiv } from "@/lib/management-dashboard/periods";
import { NETTO_COMMISSIE_PCT } from "@/lib/netto-boord";
import {
  formatSchouwWeekLabel,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import type {
  DashboardV2AdviseurBar,
  DashboardV2Bucket,
  DashboardV2Data,
  DashboardV2Period,
  DashboardV2RangeOpts,
  DashboardV2Scope,
  DashboardV2ScopeOpts,
  DashboardV2Totals,
} from "./types";
import {
  parseWeeklyGoals,
  scaleWeeklyGoalsByDays,
  type DashboardV2Goals,
} from "./goals";
import { buildDashboardV2Forecast } from "./forecast";
import {
  parseAdminTargetsStore,
  resolvePersonTargets,
  isSalesAdviseurRol,
  rolToTargetRole,
} from "@/lib/admin-targets";

const TZ = "Europe/Amsterdam";

export const DASHBOARD_V2_PERIOD_LABELS: Record<DashboardV2Period, string> = {
  last_7_days: "Afgelopen 7 dagen",
  calendar_week: "Kalenderweek",
  this_month: "Deze maand",
  last_14_days: "14 dagen",
  last_28_days: "1 maand",
  last_6_months: "6 maanden",
  all: "Alles (max data)",
  custom: "Aangepast",
};

export type DashboardV2Raw = {
  leads: { id: string; created_at: string; adviseur_id?: string | null; status?: string | null }[];
  afspraken: {
    id: string;
    lead_id: string;
    adviseur_id: string | null;
    start_at: string;
    created_at: string | null;
    status: string;
    soort: string | null;
  }[];
  offertes: {
    id: string;
    lead_id: string;
    adviseur_id: string | null;
    ondertekend_op: string | null;
    created_at: string;
    subtotaal_ex_btw: number;
    /** Getekend maar later geannuleerd (projectstatus / afgewezen) */
    geannuleerd?: boolean;
  }[];
  adviseurs: { id: string; naam: string; actief: boolean; rol: string | null }[];
};

export type Range = { start: Date; end: Date };

type AfspraakRow = DashboardV2Raw["afspraken"][0];

/**
 * Echte inplandatum: created_at. start_at verandert bij verzetten en mag
 * herboekingen niet als “nieuw gepland” laten lijken.
 */
function afspraakPlannedAt(a: Pick<AfspraakRow, "created_at" | "start_at">): string {
  return a.created_at || a.start_at;
}

function planningMs(a: Pick<AfspraakRow, "created_at" | "start_at" | "id">): number {
  const t = new Date(afspraakPlannedAt(a)).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Eerste huisbezoek-inplanning (soort nieuw) per lead.
 * Als de lead al eerder een fysieke afspraak had (ook geannuleerd/verzet),
 * telt een latere herboeking NIET mee voor Lead→afspraak.
 */
export function isEersteNieuwAfspraak(
  a: AfspraakRow,
  all: AfspraakRow[]
): boolean {
  if (normalizeAfspraakSoort(a.soort) !== "nieuw") return false;

  const myAt = planningMs(a);
  for (const x of all) {
    if (x.lead_id !== a.lead_id) continue;
    if (x.id === a.id) continue;
    // Elke eerdere fysieke afspraak = lead was al eens ingepland
    if (!afspraakBlokkeertAgenda(x.soort)) continue;
    const otherAt = planningMs(x);
    if (otherAt < myAt) return false;
    if (otherAt === myAt && x.id.localeCompare(a.id) < 0) return false;
  }
  return true;
}

/** Afspraken die meetellen voor L2A (eerste nieuw-afspraak, in range op inplandatum). */
export function afsprakenVoorL2a(
  afspraken: AfspraakRow[],
  range: Range
): AfspraakRow[] {
  return afspraken.filter((a) => {
    if (!isEersteNieuwAfspraak(a, afspraken)) return false;
    return inIsoRange(afspraakPlannedAt(a), range.start, range.end);
  });
}
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

/** Parse YYYY-MM-DD as Amsterdam calendar day. */
export function parseAmsDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const d = fromZonedTime(
    new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0),
    TZ
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

function dataSpan(raw: DashboardV2Raw, now: Date): Range {
  let minMs = Infinity;
  const push = (iso: string | null | undefined) => {
    if (!iso) return;
    const t = new Date(iso).getTime();
    if (Number.isFinite(t) && t < minMs) minMs = t;
  };
  for (const l of raw.leads) push(l.created_at);
  for (const a of raw.afspraken) {
    if (!afspraakBlokkeertAgenda(a.soort)) continue;
    push(a.created_at || a.start_at);
  }
  for (const o of raw.offertes) push(o.ondertekend_op);
  const end = amsEndOfDay(addDays(toZonedTime(now, TZ), -1));
  if (!Number.isFinite(minMs) || minMs === Infinity) {
    return { start: amsStartOfDay(addDays(end, -29)), end };
  }
  return { start: amsStartOfDay(new Date(minMs)), end };
}

function resolveCalendarWeekRange(
  now: Date,
  weekKey: string | null | undefined
): Range {
  const parsed = weekKey ? parseSchouwWeekValue(weekKey) : null;
  const { jaar, week } = parsed || schouwWeekFromDate(now);
  const monday = new Date(schouwWeekToMondayIso(jaar, week));
  return {
    start: amsStartOfDay(monday),
    end: amsEndOfDay(addDays(monday, 6)),
  };
}

export function resolveRange(
  period: DashboardV2Period,
  now = new Date(),
  opts: DashboardV2RangeOpts = {},
  raw?: DashboardV2Raw | null
): Range {
  const z = toZonedTime(now, TZ);

  if (period === "custom") {
    const from = opts.from ? parseAmsDate(opts.from) : null;
    const to = opts.to ? parseAmsDate(opts.to) : null;
    if (from && to) {
      const start = amsStartOfDay(from);
      const end = amsEndOfDay(to);
      if (start.getTime() <= end.getTime()) return { start, end };
      return { start: amsStartOfDay(to), end: amsEndOfDay(from) };
    }
    return {
      start: amsStartOfDay(addDays(z, -14)),
      end: amsEndOfDay(addDays(z, -1)),
    };
  }

  if (period === "calendar_week") {
    return resolveCalendarWeekRange(now, opts.week);
  }

  if (period === "this_month") {
    const start = amsStartOfDay(startOfMonth(z));
    const end = amsEndOfDay(z);
    return { start, end };
  }

  if (period === "all") {
    return dataSpan(
      raw || { leads: [], afspraken: [], offertes: [], adviseurs: [] },
      now
    );
  }

  switch (period) {
    case "last_7_days": {
      const end = amsEndOfDay(addDays(z, -1));
      const start = amsStartOfDay(addDays(z, -7));
      return { start, end };
    }
    case "last_14_days": {
      const end = amsEndOfDay(addDays(z, -1));
      const start = amsStartOfDay(addDays(z, -14));
      return { start, end };
    }
    case "last_28_days": {
      const end = amsEndOfDay(addDays(z, -1));
      const start = amsStartOfDay(addDays(z, -28));
      return { start, end };
    }
    case "last_6_months": {
      const end = amsEndOfDay(addDays(z, -1));
      const monthStart = startOfMonth(subMonths(z, 5));
      const start = amsStartOfDay(monthStart);
      return { start, end };
    }
  }
}

function previousEqualRange(current: Range): Range {
  const days = Math.max(
    1,
    differenceInCalendarDays(current.end, current.start) + 1
  );
  const previousEnd = amsEndOfDay(addDays(current.start, -1));
  const previousStart = amsStartOfDay(addDays(previousEnd, -(days - 1)));
  return { start: previousStart, end: previousEnd };
}

type BucketDef = { key: string; label: string; start: Date; end: Date };

/** Buckets op basis van lengte van de range. */
export function buildBucketDefsForRange(range: Range): {
  granularity: DashboardV2Data["granularity"];
  buckets: BucketDef[];
} {
  const days = Math.max(
    1,
    differenceInCalendarDays(range.end, range.start) + 1
  );

  if (days <= 21) {
    const buckets: BucketDef[] = [];
    for (let i = 0; i < days; i++) {
      const start = amsStartOfDay(addDays(range.start, i));
      if (start.getTime() > range.end.getTime()) break;
      buckets.push({
        key: formatInTimeZone(start, TZ, "yyyy-MM-dd"),
        label: formatInTimeZone(start, TZ, "EEE d MMM"),
        start,
        end: amsEndOfDay(start),
      });
    }
    return { granularity: "day", buckets };
  }

  if (days <= 90) {
    const buckets: BucketDef[] = [];
    // Align op ISO-maandag zodat buckets echte kalenderweken zijn
    const startZ = toZonedTime(range.start, TZ);
    const dow = (startZ.getDay() + 6) % 7; // ma=0 … zo=6
    let cursor = amsStartOfDay(addDays(range.start, -dow));
    while (cursor.getTime() <= range.end.getTime()) {
      const weekEnd = amsEndOfDay(addDays(cursor, 6));
      const start =
        cursor.getTime() < range.start.getTime() ? range.start : cursor;
      const end =
        weekEnd.getTime() > range.end.getTime() ? range.end : weekEnd;
      if (start.getTime() <= end.getTime()) {
        const isoWeek = getISOWeek(toZonedTime(cursor, TZ));
        const isoYear = getISOWeekYear(toZonedTime(cursor, TZ));
        buckets.push({
          key: schouwWeekValue(isoYear, isoWeek),
          label: `W${isoWeek} · ${formatInTimeZone(start, TZ, "d MMM")} – ${formatInTimeZone(end, TZ, "d MMM")}`,
          start,
          end,
        });
      }
      cursor = amsStartOfDay(addDays(cursor, 7));
    }
    return { granularity: "week", buckets };
  }

  const buckets: BucketDef[] = [];
  let cursor = amsStartOfDay(startOfMonth(toZonedTime(range.start, TZ)));
  while (cursor.getTime() <= range.end.getTime()) {
    const monthEnd = amsEndOfDay(
      addDays(amsStartOfDay(startOfMonth(addMonths(cursor, 1))), -1)
    );
    const start =
      cursor.getTime() < range.start.getTime() ? range.start : cursor;
    const end =
      monthEnd.getTime() > range.end.getTime() ? range.end : monthEnd;
    if (start.getTime() <= end.getTime()) {
      buckets.push({
        key: formatInTimeZone(start, TZ, "yyyy-MM"),
        label: formatInTimeZone(start, TZ, "MMM yyyy"),
        start,
        end,
      });
    }
    cursor = amsStartOfDay(startOfMonth(addMonths(cursor, 1)));
  }
  return { granularity: "month", buckets };
}

function emptyTotals(): DashboardV2Totals {
  return {
    leads: 0,
    afsprakenGepland: 0,
    afsprakenVoltooid: 0,
    leadToAppt: null,
    afspraakToSale: null,
    orders: 0,
    omzet: 0,
    annuleringen: 0,
    annuleringsPct: null,
    verlorenOmzet: 0,
  };
}

/** Deal-moment = alleen echte ondertekening (geen offerte-created_at). */
function dealAt(o: DashboardV2Raw["offertes"][0]): string | null {
  return o.ondertekend_op || null;
}

/**
 * Afgeboekte huisbezoeken (agenda zonder oranje “I”):
 * bezoek geweest + uitkomst gekozen of vervolg gepland.
 * Cron-`voltooid` zonder afboeking telt niet.
 */
export function afsprakenVoltooidInRange(
  afspraken: AfspraakRow[],
  range: Range,
  now = new Date(),
  leadStatusById?: Map<string, string | null>
): AfspraakRow[] {
  return afspraken.filter((a) => {
    if (!inIsoRange(a.start_at, range.start, range.end)) return false;
    const ls = leadStatusById?.get(a.lead_id) ?? null;
    return isAfgeboekteFysiekeAfspraak(
      { ...a, end_at: a.start_at },
      afspraken.map((x) => ({ ...x, end_at: x.start_at })),
      ls,
      now
    );
  });
}

function leadStatusMap(
  raw: DashboardV2Raw
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const l of raw.leads) {
    map.set(l.id, l.status ?? null);
  }
  return map;
}

export function aggRange(
  raw: DashboardV2Raw,
  range: Range,
  now = new Date()
): DashboardV2Totals {
  const leads = raw.leads.filter((l) =>
    inIsoRange(l.created_at, range.start, range.end)
  ).length;

  const afsprakenGepland = raw.afspraken.filter((a) => {
    if (!afspraakBlokkeertAgenda(a.soort)) return false;
    const at = a.created_at || a.start_at;
    return inIsoRange(at, range.start, range.end);
  }).length;

  // L2A: alleen eerste 'nieuw'-afspraak per lead (geen heringeplande herboekingen)
  const eersteAfspraken = afsprakenVoorL2a(raw.afspraken, range).length;

  const afsprakenVoltooid = afsprakenVoltooidInRange(
    raw.afspraken,
    range,
    now,
    leadStatusMap(raw)
  ).length;

  let orders = 0;
  let omzet = 0;
  let annuleringen = 0;
  let verlorenOmzet = 0;
  for (const o of raw.offertes) {
    const at = dealAt(o);
    if (!at || !inIsoRange(at, range.start, range.end)) continue;
    if (o.geannuleerd) {
      annuleringen += 1;
      verlorenOmzet += Number(o.subtotaal_ex_btw) || 0;
      continue;
    }
    orders += 1;
    omzet += Number(o.subtotaal_ex_btw) || 0;
  }

  const getekendTotaal = orders + annuleringen;
  const annuleringsPct =
    getekendTotaal > 0
      ? round2((annuleringen / getekendTotaal) * 100)
      : null;

  const l2a = safeDiv(eersteAfspraken, leads);
  const a2s = safeDiv(orders, afsprakenVoltooid);
  return {
    leads,
    afsprakenGepland,
    afsprakenVoltooid,
    leadToAppt: l2a != null ? round2(l2a * 100) : null,
    afspraakToSale: a2s != null ? round2(a2s * 100) : null,
    orders,
    omzet: round2(omzet),
    annuleringen,
    annuleringsPct,
    verlorenOmzet: round2(verlorenOmzet),
  };
}

function buildBuckets(
  raw: DashboardV2Raw,
  defs: BucketDef[],
  now = new Date()
): DashboardV2Bucket[] {
  return defs.map((b) => {
    const t = aggRange(raw, { start: b.start, end: b.end }, now);
    return {
      key: b.key,
      label: b.label,
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      ...t,
    };
  });
}

function salesAdviseurIds(raw: DashboardV2Raw): Set<string> {
  const ids = new Set<string>();
  for (const a of raw.adviseurs) {
    if (!a.actief) continue;
    const rol = (a.rol || "adviseur").toLowerCase();
    if (rol === "adviseur" || rol === "admin") ids.add(a.id);
  }
  for (const o of raw.offertes) {
    if (o.adviseur_id) ids.add(o.adviseur_id);
  }
  for (const a of raw.afspraken) {
    if (a.adviseur_id && afspraakBlokkeertAgenda(a.soort)) ids.add(a.adviseur_id);
  }
  return ids;
}

function metricsForAdviseur(
  raw: DashboardV2Raw,
  adviseurId: string,
  range: Range,
  now = new Date()
): {
  omzet: number;
  orders: number;
  afsprakenGepland: number;
  afsprakenVoltooid: number;
  afspraakToSale: number | null;
  annuleringen: number;
  annuleringsPct: number | null;
  commissie: number;
} {
  let orders = 0;
  let omzet = 0;
  let annuleringen = 0;
  for (const o of raw.offertes) {
    if (o.adviseur_id !== adviseurId) continue;
    const at = dealAt(o);
    if (!at || !inIsoRange(at, range.start, range.end)) continue;
    if (o.geannuleerd) {
      annuleringen += 1;
      continue;
    }
    orders += 1;
    omzet += Number(o.subtotaal_ex_btw) || 0;
  }

  const afsprakenGepland = raw.afspraken.filter((a) => {
    if (a.adviseur_id !== adviseurId) return false;
    if (!afspraakBlokkeertAgenda(a.soort)) return false;
    const at = a.created_at || a.start_at;
    return inIsoRange(at, range.start, range.end);
  }).length;

  const afsprakenVanAdviseur = raw.afspraken.filter(
    (a) => a.adviseur_id === adviseurId
  );
  const afsprakenVoltooid = afsprakenVoltooidInRange(
    afsprakenVanAdviseur,
    range,
    now,
    leadStatusMap(raw)
  ).length;

  const getekendTotaal = orders + annuleringen;
  const a2s = safeDiv(orders, afsprakenVoltooid);
  return {
    omzet: round2(omzet),
    orders,
    afsprakenGepland,
    afsprakenVoltooid,
    afspraakToSale: a2s != null ? round2(a2s * 100) : null,
    annuleringen,
    annuleringsPct:
      getekendTotaal > 0
        ? round2((annuleringen / getekendTotaal) * 100)
        : null,
    commissie: round2(omzet * NETTO_COMMISSIE_PCT),
  };
}

function buildAdviseurs(
  raw: DashboardV2Raw,
  current: Range,
  previous: Range,
  omzetGoals: Record<string, number>,
  now = new Date()
): DashboardV2AdviseurBar[] {
  const ids = salesAdviseurIds(raw);
  const naamById = new Map(raw.adviseurs.map((a) => [a.id, a.naam]));
  for (const id of Object.keys(omzetGoals)) ids.add(id);

  const rows: DashboardV2AdviseurBar[] = [];

  for (const id of ids) {
    const cur = metricsForAdviseur(raw, id, current, now);
    const prev = metricsForAdviseur(raw, id, previous, now);
    const omzetGoal = omzetGoals[id] || 0;
    const actief = raw.adviseurs.find((a) => a.id === id)?.actief !== false;
    if (
      cur.omzet === 0 &&
      prev.omzet === 0 &&
      cur.afsprakenGepland === 0 &&
      cur.annuleringen === 0 &&
      omzetGoal === 0 &&
      !actief
    ) {
      continue;
    }
    if (
      cur.omzet === 0 &&
      prev.omzet === 0 &&
      cur.afsprakenGepland === 0 &&
      cur.annuleringen === 0 &&
      omzetGoal === 0
    ) {
      const rol = (
        raw.adviseurs.find((a) => a.id === id)?.rol || "adviseur"
      ).toLowerCase();
      if (rol !== "adviseur" && rol !== "admin") continue;
      if (!actief) continue;
    }
    rows.push({
      id,
      naam: naamById.get(id) || "Onbekend",
      omzet: cur.omzet,
      omzetGoal,
      orders: cur.orders,
      afsprakenGepland: cur.afsprakenGepland,
      afsprakenVoltooid: cur.afsprakenVoltooid,
      afspraakToSale: cur.afspraakToSale,
      annuleringen: cur.annuleringen,
      annuleringsPct: cur.annuleringsPct,
      commissie: cur.commissie,
      previousOmzet: prev.omzet,
      deltaPct: deltaPct(cur.omzet, prev.omzet),
    });
  }

  return rows.sort(
    (a, b) => b.omzet - a.omzet || a.naam.localeCompare(b.naam, "nl")
  );
}

function previousLabelFor(period: DashboardV2Period, dayCount: number): string {
  switch (period) {
    case "last_7_days":
      return "7 dagen ervoor";
    case "calendar_week":
      return "vorige week";
    case "this_month":
      return "vorige periode";
    case "last_14_days":
      return "14 dagen ervoor";
    case "last_28_days":
      return "28 dagen ervoor";
    case "last_6_months":
      return "6 maanden ervoor";
    case "all":
      return "eerdere periode";
    case "custom":
      return `${dayCount} dagen ervoor`;
  }
}

function periodLabelFor(
  period: DashboardV2Period,
  range: Range,
  dayCount: number
): string {
  if (period === "calendar_week") {
    const { jaar, week } = schouwWeekFromDate(range.start);
    return formatSchouwWeekLabel(jaar, week);
  }
  if (period === "this_month" || period === "custom" || period === "all") {
    const a = formatInTimeZone(range.start, TZ, "d MMM yyyy");
    const b = formatInTimeZone(range.end, TZ, "d MMM yyyy");
    return period === "this_month"
      ? `Deze maand · ${a} – ${b}`
      : `${a} – ${b} (${dayCount}d)`;
  }
  return DASHBOARD_V2_PERIOD_LABELS[period];
}

function weekKeyForRange(
  period: DashboardV2Period,
  range: Range
): string | null {
  if (period !== "calendar_week") return null;
  const { jaar, week } = schouwWeekFromDate(range.start);
  return schouwWeekValue(jaar, week);
}

function filterRawForPerson(
  raw: DashboardV2Raw,
  personId: string
): DashboardV2Raw {
  return {
    leads: raw.leads.filter((l) => l.adviseur_id === personId),
    afspraken: raw.afspraken.filter((a) => a.adviseur_id === personId),
    offertes: raw.offertes.filter((o) => o.adviseur_id === personId),
    adviseurs: raw.adviseurs,
  };
}

function personWeeklyGoals(
  goalsRaw: unknown,
  personId: string,
  rol: string | null
): DashboardV2Goals {
  const store = parseAdminTargetsStore(goalsRaw);
  const targetRol = rolToTargetRole(rol);
  const { effective } = resolvePersonTargets(store, targetRol, personId);
  return {
    leads: effective.leads,
    afsprakenGepland: effective.afsprakenGepland,
    leadToAppt: effective.leadToAppt,
    afspraakToSale: effective.afspraakToSale,
    orders: effective.orders,
    omzet: effective.omzet,
    omzetPerAdviseur: { [personId]: effective.omzet },
  };
}

export function buildDashboardV2(
  raw: DashboardV2Raw,
  period: DashboardV2Period,
  goalsRaw: unknown = null,
  now = new Date(),
  rangeOpts: DashboardV2RangeOpts = {},
  scopeOpts: DashboardV2ScopeOpts = {}
): DashboardV2Data {
  const scope: DashboardV2Scope = scopeOpts.scope || "team";
  const personId =
    scope !== "team" && scopeOpts.personId ? scopeOpts.personId : null;
  const person = personId
    ? raw.adviseurs.find((a) => a.id === personId) || null
    : null;

  const scopedRaw =
    personId && person ? filterRawForPerson(raw, personId) : raw;

  const range = resolveRange(period, now, rangeOpts, scopedRaw);
  const prev = previousEqualRange(range);
  const dayCount = Math.max(
    1,
    differenceInCalendarDays(range.end, range.start) + 1
  );
  const { granularity, buckets: defs } = buildBucketDefsForRange(range);
  const buckets = buildBuckets(scopedRaw, defs, now);
  const totals = aggRange(scopedRaw, range, now);
  const previous = aggRange(scopedRaw, prev, now);

  const weeklyGoals =
    personId && person
      ? personWeeklyGoals(goalsRaw, personId, person.rol)
      : parseWeeklyGoals(
          goalsRaw,
          raw.adviseurs.map((a) => ({
            id: a.id,
            rol: a.rol,
            actief: a.actief,
          }))
        );
  const goals = scaleWeeklyGoalsByDays(weeklyGoals, dayCount);

  const people = raw.adviseurs
    .filter((a) => a.actief)
    .filter((a) => {
      const r = (a.rol || "").toLowerCase();
      if (scope === "adviseur") return isSalesAdviseurRol(a.rol);
      if (scope === "beller") return r === "beller";
      return true;
    })
    .map((a) => ({
      id: a.id,
      naam: a.naam,
      rol: a.rol || "adviseur",
    }))
    .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));

  return {
    period,
    periodLabel: periodLabelFor(period, range, dayCount),
    previousLabel: previousLabelFor(period, dayCount),
    granularity,
    rangeStart: range.start.toISOString(),
    rangeEnd: range.end.toISOString(),
    fromDate: formatInTimeZone(range.start, TZ, "yyyy-MM-dd"),
    toDate: formatInTimeZone(range.end, TZ, "yyyy-MM-dd"),
    weekKey: weekKeyForRange(period, range),
    dayCount,
    scope,
    personId,
    personNaam: person?.naam || null,
    buckets,
    totals,
    previous,
    deltas: {
      leads: deltaPct(totals.leads, previous.leads),
      afsprakenGepland: deltaPct(
        totals.afsprakenGepland,
        previous.afsprakenGepland
      ),
      afsprakenVoltooid: deltaPct(
        totals.afsprakenVoltooid,
        previous.afsprakenVoltooid
      ),
      leadToAppt:
        totals.leadToAppt != null && previous.leadToAppt != null
          ? round2(totals.leadToAppt - previous.leadToAppt)
          : null,
      afspraakToSale:
        totals.afspraakToSale != null && previous.afspraakToSale != null
          ? round2(totals.afspraakToSale - previous.afspraakToSale)
          : null,
      orders: deltaPct(totals.orders, previous.orders),
      omzet: deltaPct(totals.omzet, previous.omzet),
      annuleringen: deltaPct(totals.annuleringen, previous.annuleringen),
      annuleringsPct:
        totals.annuleringsPct != null && previous.annuleringsPct != null
          ? round2(totals.annuleringsPct - previous.annuleringsPct)
          : null,
      verlorenOmzet: deltaPct(totals.verlorenOmzet, previous.verlorenOmzet),
    },
    goals,
    goalsWeekly: weeklyGoals,
    adviseurs: buildAdviseurs(
      scopedRaw,
      range,
      prev,
      goals.omzetPerAdviseur || {},
      now
    ),
    people,
    forecast: buildDashboardV2Forecast(scopedRaw, now),
  };
}

export function resolveDashboardV2Range(
  period: DashboardV2Period,
  now = new Date(),
  opts: DashboardV2RangeOpts = {},
  raw?: DashboardV2Raw | null
): Range {
  return resolveRange(period, now, opts, raw);
}

export function amsDayKey(iso: string): string {
  return formatInTimeZone(new Date(iso), TZ, "yyyy-MM-dd");
}

export function eachDayInRange(
  range: Range
): { key: string; label: string; start: Date; end: Date }[] {
  const days: { key: string; label: string; start: Date; end: Date }[] = [];
  const total = Math.max(
    1,
    differenceInCalendarDays(range.end, range.start) + 1
  );
  for (let i = 0; i < total; i++) {
    const start = amsStartOfDay(addDays(range.start, i));
    if (start.getTime() > range.end.getTime()) break;
    days.push({
      key: formatInTimeZone(start, TZ, "yyyy-MM-dd"),
      label: formatInTimeZone(start, TZ, "EEE d MMM"),
      start,
      end: amsEndOfDay(start),
    });
  }
  return days;
}

export { dealAt, afspraakInPeriod, emptyTotals };

function afspraakInPeriod(
  a: DashboardV2Raw["afspraken"][0],
  range: Range
): boolean {
  if (!afspraakBlokkeertAgenda(a.soort)) return false;
  const at = a.created_at || a.start_at;
  return inIsoRange(at, range.start, range.end);
}

export function parseDashboardV2Period(v: string | null): DashboardV2Period {
  if (
    v === "last_7_days" ||
    v === "calendar_week" ||
    v === "this_month" ||
    v === "last_14_days" ||
    v === "last_28_days" ||
    v === "last_6_months" ||
    v === "all" ||
    v === "custom"
  ) {
    return v;
  }
  return "last_14_days";
}

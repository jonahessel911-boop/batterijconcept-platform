/**
 * CEO unit-targets: balkjes (L→A · close · agenda · acties op tijd).
 */

import { addDays, getDaysInMonth } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import {
  loadAfblokkingen,
  loadSlotVrijgaven,
  weekKeyString,
} from "@/lib/adviseur-beschikbaarheid";
import {
  huisbezoekLeadIdsOpDag,
  type BelConversieAfspraak,
} from "@/lib/bel-conversie";
import { countOpenSlotsInYmdRange } from "@/lib/dashboard-v2/capacity";
import { AMSTERDAM_TZ } from "@/lib/format";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import {
  formatSchouwWeekLabel,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";

export type CeoUnitPeriod =
  | "week"
  | "biweekly"
  | "month"
  | "quarter"
  | "year"
  | "all";

export const CEO_L2A_TARGET_PCT = 25;
export const CEO_CLOSE_TARGET_PCT = 25;
export const CEO_FILL_TARGET_PCT = 80;
export const CEO_ACTIONS_ONTIME_TARGET_PCT = 100;
/** Vanaf wanneer “alles” telt (aanmeldingen). */
const CEO_ALL_FROM_YMD = "2024-01-01";

export type CeoUnitBar = {
  id: "l2a" | "close" | "fill" | "actions";
  /** Korte labelregel */
  label: string;
  /** Doel-rate of -aantal voor de balk (100% = doel gehaald) */
  target: number;
  actual: number;
  /** 0–100 vulling t.o.v. target */
  barPct: number;
  /** Tussen haakjes: doel · nu */
  detail: string;
  onTrack: boolean;
};

export type CeoUnitTargetsResult = {
  period: CeoUnitPeriod;
  periodLabel: string;
  startYmd: string;
  endYmd: string;
  bars: CeoUnitBar[];
};

function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function amsBounds(ymd: string): { start: Date; end: Date } {
  const [y, m, d] = ymd.split("-").map(Number);
  return {
    start: fromZonedTime(new Date(y, m - 1, d, 0, 0, 0, 0), AMSTERDAM_TZ),
    end: fromZonedTime(new Date(y, m - 1, d, 23, 59, 59, 999), AMSTERDAM_TZ),
  };
}

function noonYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(new Date(y, m - 1, d, 12, 0, 0), AMSTERDAM_TZ);
}

function daysInclusive(startYmd: string, endYmd: string): number {
  if (startYmd > endYmd) return 0;
  return (
    Math.round(
      (noonYmd(endYmd).getTime() - noonYmd(startYmd).getTime()) / 86_400_000
    ) + 1
  );
}

function resolvePeriod(
  period: CeoUnitPeriod,
  todayYmd: string
): { startYmd: string; endYmd: string; periodLabel: string } {
  if (period === "biweekly") {
    const w = schouwWeekFromDate(new Date(`${todayYmd}T12:00:00`));
    const thisMon = String(schouwWeekToMondayIso(w.jaar, w.week)).slice(0, 10);
    // Twee kalenderweken: vorige + deze ISO-week
    const startYmd = ymdAmsterdam(addDays(noonYmd(thisMon), -7));
    const endYmd = ymdAmsterdam(addDays(noonYmd(thisMon), 6));
    const prev = schouwWeekFromDate(noonYmd(startYmd));
    return {
      startYmd,
      endYmd,
      periodLabel: `${formatSchouwWeekLabel(prev.jaar, prev.week)} – ${formatSchouwWeekLabel(w.jaar, w.week)}`,
    };
  }

  if (period === "month") {
    const ym = todayYmd.slice(0, 7);
    const [y, m] = ym.split("-").map(Number);
    const days = getDaysInMonth(new Date(y, m - 1, 1));
    const startYmd = `${ym}-01`;
    const endYmd = `${ym}-${String(days).padStart(2, "0")}`;
    const monthLabel = new Intl.DateTimeFormat("nl-NL", {
      month: "long",
      year: "numeric",
      timeZone: AMSTERDAM_TZ,
    }).format(noonYmd(`${ym}-15`));
    return {
      startYmd,
      endYmd,
      periodLabel: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1),
    };
  }

  if (period === "quarter") {
    const [y, m] = todayYmd.split("-").map(Number);
    const q = Math.floor((m - 1) / 3) + 1;
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const startYmd = `${y}-${String(startMonth).padStart(2, "0")}-01`;
    const endDays = getDaysInMonth(new Date(y, endMonth - 1, 1));
    const endYmd = `${y}-${String(endMonth).padStart(2, "0")}-${String(endDays).padStart(2, "0")}`;
    return {
      startYmd,
      endYmd,
      periodLabel: `Q${q} ${y}`,
    };
  }

  if (period === "year") {
    const y = todayYmd.slice(0, 4);
    return {
      startYmd: `${y}-01-01`,
      endYmd: `${y}-12-31`,
      periodLabel: y,
    };
  }

  if (period === "all") {
    return {
      startYmd: CEO_ALL_FROM_YMD,
      endYmd: todayYmd,
      periodLabel: "Alles",
    };
  }

  const w = schouwWeekFromDate(new Date(`${todayYmd}T12:00:00`));
  const startYmd = String(schouwWeekToMondayIso(w.jaar, w.week)).slice(0, 10);
  const endYmd = ymdAmsterdam(addDays(noonYmd(startYmd), 6));
  return {
    startYmd,
    endYmd,
    periodLabel: formatSchouwWeekLabel(w.jaar, w.week),
  };
}

function barAgainstTarget(actual: number, target: number): {
  barPct: number;
  onTrack: boolean;
} {
  if (target <= 0) {
    return { barPct: actual > 0 ? 100 : 0, onTrack: actual > 0 };
  }
  const barPct = Math.min(100, Math.round((actual / target) * 100));
  return { barPct, onTrack: actual >= target };
}

/** L→A % in een venster (ingepland ÷ gebeld). */
async function leadToApptPctInRange(
  sb: SupabaseClient,
  start: Date,
  end: Date
): Promise<number | null> {
  const [gebeldRes, afsRes] = await Promise.all([
    sb
      .from("leads")
      .select("id")
      .gte("laatst_gebeld_at", start.toISOString())
      .lte("laatst_gebeld_at", end.toISOString()),
    sb
      .from("afspraken")
      .select("id, lead_id, created_at, start_at, status, soort")
      .eq("soort", "nieuw")
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString()),
  ]);
  if (gebeldRes.error || afsRes.error) return null;
  const afsRows = (afsRes.data || []) as BelConversieAfspraak[];
  const leadIds = [...new Set(afsRows.map((a) => a.lead_id).filter(Boolean))];
  let historie = afsRows;
  if (leadIds.length > 0) {
    const { data: hist } = await sb
      .from("afspraken")
      .select("id, lead_id, created_at, start_at, status, soort")
      .eq("soort", "nieuw")
      .in("lead_id", leadIds);
    if (hist) historie = hist as BelConversieAfspraak[];
  }
  const ingeplandIds = huisbezoekLeadIdsOpDag(afsRows, start, end, historie);
  const gebeldIds = new Set((gebeldRes.data || []).map((l) => l.id as string));
  for (const id of ingeplandIds) gebeldIds.add(id);
  const gebeld = gebeldIds.size;
  if (gebeld <= 0) return null;
  return Math.round((ingeplandIds.size / gebeld) * 1000) / 10;
}

export type CeoPlanbaarAdviseur = {
  id: string;
  naam: string;
  email: string | null;
  rol: string | null;
  actief: boolean;
  startdatum: string | null;
};

/**
 * Basis lead-doel = 80% van planbare slots vanaf `todayYmd` over `forwardDays`,
 * gedeeld door L→A over `lookbackDays` eindigend op `todayYmd`.
 */
export async function leadsNeededForForwardHorizon(
  sb: SupabaseClient,
  opts: {
    todayYmd: string;
    forwardDays: number;
    lookbackDays: number;
    adviseursCap: CeoPlanbaarAdviseur[];
    unavailableByAdviseur: Map<string, Set<string>>;
  }
): Promise<{ slotsOpen: number; l2aPct: number; targetAppts: number; targetLeads: number }> {
  const fwdStart = opts.todayYmd;
  const fwdEnd = ymdAmsterdam(
    addDays(noonYmd(opts.todayYmd), opts.forwardDays - 1)
  );
  const lookbackStart = ymdAmsterdam(
    addDays(noonYmd(opts.todayYmd), -(opts.lookbackDays - 1))
  );
  const adviseurIds = opts.adviseursCap.map((a) => a.id);
  const [afblokkingen, vrijgaven, l2a] = await Promise.all([
    loadAfblokkingen(sb, { adviseurIds, van: fwdStart, tot: fwdEnd }),
    loadSlotVrijgaven(sb, { adviseurIds, van: fwdStart, tot: fwdEnd }),
    leadToApptPctInRange(
      sb,
      amsBounds(lookbackStart).start,
      amsBounds(opts.todayYmd).end
    ),
  ]);
  const slotsOpen = countOpenSlotsInYmdRange({
    startYmd: fwdStart,
    endYmd: fwdEnd,
    adviseurs: opts.adviseursCap,
    unavailableByAdviseur: opts.unavailableByAdviseur,
    afblokkingen,
    vrijgaven,
  });
  const l2aPct =
    l2a != null && l2a > 0 ? l2a : CEO_L2A_TARGET_PCT;
  const targetAppts = Math.ceil(
    Math.max(0, slotsOpen) * (CEO_FILL_TARGET_PCT / 100)
  );
  const targetLeads = Math.ceil(targetAppts / (l2aPct / 100));
  return { slotsOpen, l2aPct, targetAppts, targetLeads };
}

async function loadUnavailableByAdviseur(
  sb: SupabaseClient,
  adviseurIds: string[],
  jaren: number[]
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (!adviseurIds.length || !jaren.length) return map;
  const { data, error } = await sb
    .from("adviseur_beschikbaarheid")
    .select("adviseur_id, jaar, week, beschikbaar")
    .in("adviseur_id", adviseurIds)
    .in("jaar", jaren)
    .eq("beschikbaar", false);
  if (error) {
    if (
      error.code === "42703" ||
      error.code === "42P01" ||
      error.message?.includes("adviseur_beschikbaarheid") ||
      error.message?.includes("schema cache")
    ) {
      return map;
    }
    throw error;
  }
  for (const row of data || []) {
    const aid = row.adviseur_id as string;
    const key = weekKeyString(row.jaar as number, row.week as number);
    if (!map.has(aid)) map.set(aid, new Set());
    map.get(aid)!.add(key);
  }
  return map;
}

export async function buildCeoUnitTargets(
  sb: SupabaseClient,
  opts: { period: CeoUnitPeriod; now?: Date }
): Promise<CeoUnitTargetsResult> {
  const now = opts.now ?? new Date();
  const todayYmd = ymdAmsterdam(now);
  const range = resolvePeriod(opts.period, todayYmd);
  const countEndYmd = range.endYmd > todayYmd ? todayYmd : range.endYmd;
  const { start: fromDate } = amsBounds(range.startYmd);
  const { end: toDate } = amsBounds(countEndYmd);

  const [gebeldRows, aanmeldCountRes, afsRowsRaw, salesCountRes, adviseursRaw, actieEvents] =
    await Promise.all([
      fetchAllRows<{ id: string }>((fromIdx, toIdx) =>
        sb
          .from("leads")
          .select("id")
          .gte("laatst_gebeld_at", fromDate.toISOString())
          .lte("laatst_gebeld_at", toDate.toISOString())
          .order("id")
          .range(fromIdx, toIdx)
      ),
      sb
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", fromDate.toISOString())
        .lte("created_at", toDate.toISOString()),
      fetchAllRows<BelConversieAfspraak>((fromIdx, toIdx) =>
        sb
          .from("afspraken")
          .select("id, lead_id, created_at, start_at, status, soort")
          .eq("soort", "nieuw")
          .gte("created_at", fromDate.toISOString())
          .lte("created_at", toDate.toISOString())
          .order("created_at", { ascending: true })
          .range(fromIdx, toIdx)
      ),
      sb
        .from("offertes")
        .select("id", { count: "exact", head: true })
        .eq("status", "ondertekend")
        .not("ondertekend_op", "is", null)
        .gte("ondertekend_op", fromDate.toISOString())
        .lte("ondertekend_op", toDate.toISOString()),
      sb
        .from("adviseurs")
        .select("id, naam, email, rol, actief, startdatum")
        .eq("actief", true),
      fetchAllRows<{
        id: string;
        completed_at: string | null;
        deadline_at: string | null;
        on_time: boolean | null;
      }>((fromIdx, toIdx) =>
        sb
          .from("backoffice_actie_events")
          .select("id, completed_at, deadline_at, on_time")
          .not("deadline_at", "is", null)
          .gte("completed_at", fromDate.toISOString())
          .lte("completed_at", toDate.toISOString())
          .order("completed_at", { ascending: true })
          .range(fromIdx, toIdx)
      ).catch(() => []),
    ]);

  if (aanmeldCountRes.error) throw aanmeldCountRes.error;
  if (salesCountRes.error) throw salesCountRes.error;
  if (adviseursRaw.error) throw adviseursRaw.error;

  const afsRows = afsRowsRaw;
  const leadIdsNieuw = [
    ...new Set(afsRows.map((a) => a.lead_id).filter(Boolean)),
  ];
  let historie = afsRows;
  if (leadIdsNieuw.length > 0) {
    const allHist: BelConversieAfspraak[] = [];
    for (let i = 0; i < leadIdsNieuw.length; i += 200) {
      const slice = leadIdsNieuw.slice(i, i + 200);
      const chunk = await fetchAllRows<BelConversieAfspraak>((fromIdx, toIdx) =>
        sb
          .from("afspraken")
          .select("id, lead_id, created_at, start_at, status, soort")
          .eq("soort", "nieuw")
          .in("lead_id", slice)
          .order("created_at", { ascending: true })
          .range(fromIdx, toIdx)
      );
      allHist.push(...chunk);
    }
    if (allHist.length > 0) historie = allHist;
  }

  const ingeplandIds = huisbezoekLeadIdsOpDag(
    afsRows,
    fromDate,
    toDate,
    historie
  );
  const gebeldIds = new Set(gebeldRows.map((l) => l.id));
  for (const id of ingeplandIds) gebeldIds.add(id);

  const gebeld = gebeldIds.size;
  const ingepland = ingeplandIds.size;
  const aanmeldingen = aanmeldCountRes.count ?? 0;
  const sales = salesCountRes.count ?? 0;

  const l2aPct =
    gebeld > 0 ? Math.round((ingepland / gebeld) * 1000) / 10 : null;
  const closePct =
    ingepland > 0 ? Math.round((sales / ingepland) * 1000) / 10 : null;

  let actiesOpTijd = 0;
  let actiesVoltooid = 0;
  for (const e of actieEvents) {
    if (!e.completed_at || !e.deadline_at) continue;
    actiesVoltooid += 1;
    const onTime =
      e.on_time != null
        ? Boolean(e.on_time)
        : new Date(e.completed_at as string).getTime() <=
          new Date(e.deadline_at as string).getTime();
    if (onTime) actiesOpTijd += 1;
  }
  const actionsPct =
    actiesVoltooid > 0
      ? Math.round((actiesOpTijd / actiesVoltooid) * 1000) / 10
      : null;

  const adviseursCap = (adviseursRaw.data || [])
    .filter((a) =>
      isPlanbaarAdviseur({
        naam: a.naam as string,
        email: (a.email as string | null) ?? null,
        actief: a.actief !== false,
        rol: (a.rol as string | null) ?? null,
      })
    )
    .map((a) => ({
      id: a.id as string,
      naam: (a.naam as string) || "Adviseur",
      email: (a.email as string | null) ?? null,
      rol: (a.rol as string | null) ?? null,
      actief: a.actief !== false,
      startdatum: (a.startdatum as string | null) ?? null,
    }));
  const adviseurIds = adviseursCap.map((a) => a.id);
  const jaren = [
    ...new Set([
      Number(range.startYmd.slice(0, 4)),
      Number(range.endYmd.slice(0, 4)),
      Number(todayYmd.slice(0, 4)),
      getISOWeekYearSafe(todayYmd),
      Number(ymdAmsterdam(addDays(noonYmd(todayYmd), 13)).slice(0, 4)),
    ]),
  ];
  const unavailableByAdviseur = await loadUnavailableByAdviseur(
    sb,
    adviseurIds,
    jaren
  );

  // Basis: 14-dagen planningshorizon (adviseurs plannen 2 weken vooruit)
  const biweeklyNeed = await leadsNeededForForwardHorizon(sb, {
    todayYmd,
    forwardDays: 14,
    lookbackDays: 14,
    adviseursCap,
    unavailableByAdviseur,
  });

  let targetLeads = biweeklyNeed.targetLeads;
  if (opts.period === "week") {
    const weekNeed = await leadsNeededForForwardHorizon(sb, {
      todayYmd,
      forwardDays: 7,
      lookbackDays: 7,
      adviseursCap,
      unavailableByAdviseur,
    });
    targetLeads = weekNeed.targetLeads;
  } else if (opts.period === "biweekly") {
    targetLeads = biweeklyNeed.targetLeads;
  } else if (opts.period === "month") {
    targetLeads = biweeklyNeed.targetLeads * 2;
  } else if (opts.period === "quarter") {
    targetLeads = biweeklyNeed.targetLeads * 6;
  } else if (opts.period === "year") {
    targetLeads = biweeklyNeed.targetLeads * 26;
  } else if (opts.period === "all") {
    const years = Math.max(
      1,
      daysInclusive(range.startYmd, countEndYmd) / 365
    );
    targetLeads = Math.ceil(biweeklyNeed.targetLeads * 26 * years);
  }

  // Op tempo t.o.v. verstreken deel van de periode
  const periodDays = Math.max(1, daysInclusive(range.startYmd, range.endYmd));
  const elapsedDays = Math.max(
    1,
    daysInclusive(range.startYmd, countEndYmd)
  );
  const paceTarget = Math.max(
    1,
    Math.ceil((targetLeads * elapsedDays) / periodDays)
  );

  const l2aBar = barAgainstTarget(l2aPct ?? 0, CEO_L2A_TARGET_PCT);
  const closeBar = barAgainstTarget(closePct ?? 0, CEO_CLOSE_TARGET_PCT);
  const fillBar = barAgainstTarget(aanmeldingen, targetLeads);
  const fillOnTrack = aanmeldingen >= paceTarget;
  const actionsBar = barAgainstTarget(
    actionsPct ?? 0,
    CEO_ACTIONS_ONTIME_TARGET_PCT
  );

  const fmt = (n: number) =>
    Number.isInteger(n)
      ? n.toLocaleString("nl-NL")
      : n.toLocaleString("nl-NL", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        });

  const bars: CeoUnitBar[] = [
    {
      id: "l2a",
      label: `${CEO_L2A_TARGET_PCT}% lead → appointment`,
      target: CEO_L2A_TARGET_PCT,
      actual: l2aPct ?? 0,
      barPct: l2aBar.barPct,
      detail:
        l2aPct != null ? `${fmt(l2aPct)}%/${CEO_L2A_TARGET_PCT}%` : `—/${CEO_L2A_TARGET_PCT}%`,
      onTrack: l2aBar.onTrack && l2aPct != null,
    },
    {
      id: "close",
      label: `${CEO_CLOSE_TARGET_PCT}% appointment → sale`,
      target: CEO_CLOSE_TARGET_PCT,
      actual: closePct ?? 0,
      barPct: closeBar.barPct,
      detail:
        closePct != null
          ? `${fmt(closePct)}%/${CEO_CLOSE_TARGET_PCT}%`
          : `—/${CEO_CLOSE_TARGET_PCT}%`,
      onTrack: closeBar.onTrack && closePct != null,
    },
    {
      id: "fill",
      label: "Leads",
      target: targetLeads,
      actual: aanmeldingen,
      barPct: fillBar.barPct,
      detail: `${fmt(aanmeldingen)}/${fmt(targetLeads)}`,
      onTrack: fillOnTrack,
    },
    {
      id: "actions",
      label: `${CEO_ACTIONS_ONTIME_TARGET_PCT}% acties op tijd`,
      target: CEO_ACTIONS_ONTIME_TARGET_PCT,
      actual: actionsPct ?? 0,
      barPct: actionsBar.barPct,
      detail:
        actionsPct != null
          ? `${fmt(actionsPct)}%/${CEO_ACTIONS_ONTIME_TARGET_PCT}%`
          : `—/${CEO_ACTIONS_ONTIME_TARGET_PCT}%`,
      onTrack: actionsBar.onTrack && actionsPct != null,
    },
  ];

  return {
    period: opts.period,
    periodLabel: range.periodLabel,
    startYmd: range.startYmd,
    endYmd: range.endYmd,
    bars,
  };
}

function getISOWeekYearSafe(ymd: string): number {
  const w = schouwWeekFromDate(new Date(`${ymd}T12:00:00`));
  return w.jaar;
}

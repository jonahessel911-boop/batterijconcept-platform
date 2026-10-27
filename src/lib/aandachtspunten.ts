/**
 * Simpele aandachtspunten: 3 bars huidig vs doel (leads · geplande afspraken · sales).
 * Geplande-afspraken-doel = open (niet-afgeblokte) slots in de periode.
 */

import { addDays, getDaysInMonth, getISOWeekYear } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import {
  loadAfblokkingen,
  loadSlotVrijgaven,
  weekKeyString,
} from "@/lib/adviseur-beschikbaarheid";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  DEFAULT_AFSPRAAK_TO_SALE_PCT,
  DEFAULT_TARGETS,
  parseAdminTargetsStore,
  teamWeeklySnapshot,
} from "@/lib/admin-targets";
import { countOpenSlotsInYmdRange } from "@/lib/dashboard-v2/capacity";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import {
  formatSchouwWeekLabel,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";

export type AandachtBarId = "leads" | "afspraken" | "sales";

export type AandachtBar = {
  id: AandachtBarId;
  label: string;
  unitLabel: string;
  actual: number;
  /** Volledig periodedoel */
  target: number;
  /** Verwacht tot nu toe (tempo) */
  paceTarget: number;
  /** actual >= paceTarget */
  onTrack: boolean;
};

export type AandachtspuntenResult = {
  mode: "week" | "month";
  periodLabel: string;
  startYmd: string;
  endYmd: string;
  todayYmd: string;
  bars: AandachtBar[];
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

function scaleWeekTarget(weekTarget: number, daysInPeriod: number): number {
  return Math.round((weekTarget * daysInPeriod) / 7);
}

function resolveRange(opts: {
  mode: "week" | "month";
  weekKey?: string | null;
  monthYm?: string | null;
  todayYmd: string;
}): { startYmd: string; endYmd: string; periodLabel: string; daysInPeriod: number } {
  if (opts.mode === "month") {
    const ym =
      opts.monthYm && /^\d{4}-\d{2}$/.test(opts.monthYm)
        ? opts.monthYm
        : opts.todayYmd.slice(0, 7);
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
      daysInPeriod: days,
    };
  }

  let weekKey = opts.weekKey?.trim() || "";
  if (!weekKey) {
    const w = schouwWeekFromDate(new Date(`${opts.todayYmd}T12:00:00`));
    weekKey = schouwWeekValue(w.jaar, w.week);
  }
  const parsed = parseSchouwWeekValue(weekKey);
  const w =
    parsed ||
    schouwWeekFromDate(new Date(`${opts.todayYmd}T12:00:00`));
  const startYmd = String(schouwWeekToMondayIso(w.jaar, w.week)).slice(0, 10);
  const endYmd = ymdAmsterdam(addDays(noonYmd(startYmd), 6));
  return {
    startYmd,
    endYmd,
    periodLabel: formatSchouwWeekLabel(w.jaar, w.week),
    daysInPeriod: 7,
  };
}

function inYmdRange(iso: string | null | undefined, start: string, end: string) {
  if (!iso) return false;
  const ymd = formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "yyyy-MM-dd");
  return ymd >= start && ymd <= end;
}

function isNieuweHuisbezoek(a: {
  status: string | null;
  soort: string | null;
}): boolean {
  if (a.status === "geannuleerd") return false;
  return (a.soort || "").trim() === "nieuw";
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

export async function buildAandachtspunten(
  sb: SupabaseClient,
  opts: {
    mode: "week" | "month";
    weekKey?: string | null;
    monthYm?: string | null;
    now?: Date;
  }
): Promise<AandachtspuntenResult> {
  const now = opts.now ?? new Date();
  const todayYmd = ymdAmsterdam(now);
  const range = resolveRange({
    mode: opts.mode,
    weekKey: opts.weekKey,
    monthYm: opts.monthYm,
    todayYmd,
  });

  // Effectieve einddatum voor tellingen t/m nu: niet voorbij vandaag
  const countEndYmd = range.endYmd > todayYmd ? todayYmd : range.endYmd;
  const { start: fromDate } = amsBounds(range.startYmd);
  const { end: toDate } = amsBounds(countEndYmd);
  // Hele periode (incl. rest van de week) voor agenda-afspraken → sales-doel
  const { end: periodEndDate } = amsBounds(range.endYmd);

  const yStart = getISOWeekYear(toZonedTime(noonYmd(range.startYmd), AMSTERDAM_TZ));
  const yEnd = getISOWeekYear(toZonedTime(noonYmd(range.endYmd), AMSTERDAM_TZ));
  const jaren = [...new Set([yStart - 1, yStart, yEnd, yEnd + 1])];

  const [
    { data: goalsRow },
    { data: adviseursRaw },
    leads,
    afsprakenIngepland,
    afsprakenOpAgenda,
    offertes,
  ] = await Promise.all([
      sb
        .from("dashboard_instellingen")
        .select("dashboard_v2_doelen")
        .eq("actief", true)
        .limit(1)
        .maybeSingle(),
      sb
        .from("adviseurs")
        .select("id, naam, email, rol, actief, startdatum")
        .eq("actief", true),
      fetchAllRows<{ id: string; created_at: string }>((fromIdx, toIdx) =>
        sb
          .from("leads")
          .select("id, created_at")
          .gte("created_at", fromDate.toISOString())
          .lte("created_at", toDate.toISOString())
          .order("created_at", { ascending: true })
          .range(fromIdx, toIdx)
      ),
      // Bel/plan-tempo: nieuw ingepland (created_at) in periode t/m nu
      fetchAllRows<{
        id: string;
        created_at: string;
        status: string;
        soort: string | null;
      }>((fromIdx, toIdx) =>
        sb
          .from("afspraken")
          .select("id, created_at, status, soort")
          .gte("created_at", fromDate.toISOString())
          .lte("created_at", toDate.toISOString())
          .neq("status", "geannuleerd")
          .order("created_at", { ascending: true })
          .range(fromIdx, toIdx)
      ),
      // Sales-basis: huisbezoeken die deze week/maand op de agenda staan
      fetchAllRows<{
        id: string;
        start_at: string;
        status: string;
        soort: string | null;
      }>((fromIdx, toIdx) =>
        sb
          .from("afspraken")
          .select("id, start_at, status, soort")
          .gte("start_at", fromDate.toISOString())
          .lte("start_at", periodEndDate.toISOString())
          .neq("status", "geannuleerd")
          .order("start_at", { ascending: true })
          .range(fromIdx, toIdx)
      ),
      fetchAllRows<{ id: string; ondertekend_op: string | null }>(
        (fromIdx, toIdx) =>
          sb
            .from("offertes")
            .select("id, ondertekend_op")
            .eq("status", "ondertekend")
            .not("ondertekend_op", "is", null)
            .gte("ondertekend_op", fromDate.toISOString())
            .lte("ondertekend_op", toDate.toISOString())
            .order("ondertekend_op", { ascending: true })
            .range(fromIdx, toIdx)
      ),
    ]);

  const adviseursCap = (adviseursRaw || [])
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

  const [unavailableByAdviseur, afblokkingen, vrijgaven] = await Promise.all([
    loadUnavailableByAdviseur(sb, adviseurIds, jaren),
    loadAfblokkingen(sb, {
      adviseurIds,
      van: range.startYmd,
      tot: range.endYmd,
    }),
    loadSlotVrijgaven(sb, {
      adviseurIds,
      van: range.startYmd,
      tot: range.endYmd,
    }),
  ]);

  // Weekdoel Geplande afspraken = alle niet-afgeblokte open slots in de periode
  const targetAppt = countOpenSlotsInYmdRange({
    startYmd: range.startYmd,
    endYmd: range.endYmd,
    adviseurs: adviseursCap,
    unavailableByAdviseur,
    afblokkingen,
    vrijgaven,
  });

  const store = parseAdminTargetsStore(
    (goalsRow as { dashboard_v2_doelen?: unknown } | null)?.dashboard_v2_doelen
  );
  const snap = teamWeeklySnapshot(store, adviseursRaw || [], {
    asOfYmd: countEndYmd,
    periodStartYmd: range.startYmd,
    periodEndYmd: countEndYmd,
  });
  const weekLeads = snap.leads || DEFAULT_TARGETS.team.leads;
  const targetLeads = scaleWeekTarget(weekLeads, range.daysInPeriod);

  const daysElapsed = Math.max(
    1,
    Math.round(
      (noonYmd(countEndYmd).getTime() - noonYmd(range.startYmd).getTime()) /
        86_400_000
    ) + 1
  );
  const paceFrac = Math.min(1, daysElapsed / range.daysInPeriod);

  const leadsActual = leads.filter((l) =>
    inYmdRange(l.created_at, range.startYmd, countEndYmd)
  ).length;
  const apptActual = afsprakenIngepland.filter(
    (a) =>
      isNieuweHuisbezoek(a) &&
      inYmdRange(a.created_at, range.startYmd, countEndYmd)
  ).length;
  // Afspraken op de agenda in deze week/maand (hele periode)
  const apptOpAgenda = afsprakenOpAgenda.filter(
    (a) =>
      isNieuweHuisbezoek(a) &&
      inYmdRange(a.start_at, range.startYmd, range.endYmd)
  ).length;
  // Sales-doel = 30% van de afspraken die deze periode gepland staan
  const targetSales = Math.round(
    (apptOpAgenda * DEFAULT_AFSPRAAK_TO_SALE_PCT) / 100
  );
  const salesActual = offertes.filter((o) =>
    inYmdRange(o.ondertekend_op, range.startYmd, countEndYmd)
  ).length;

  function bar(
    id: AandachtBarId,
    label: string,
    unitLabel: string,
    actual: number,
    target: number
  ): AandachtBar {
    const paceTarget = Math.max(1, Math.round(target * paceFrac));
    return {
      id,
      label,
      unitLabel,
      actual,
      target,
      paceTarget,
      onTrack: actual >= paceTarget,
    };
  }

  return {
    mode: opts.mode,
    periodLabel: range.periodLabel,
    startYmd: range.startYmd,
    endYmd: range.endYmd,
    todayYmd,
    bars: [
      bar("leads", "Leads", "Leads", leadsActual, targetLeads),
      bar(
        "afspraken",
        "Geplande afspraken",
        "Bellen / planning",
        apptActual,
        targetAppt
      ),
      bar("sales", "Sales", "Sales", salesActual, targetSales),
    ],
  };
}

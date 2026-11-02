/**
 * Simpele aandachtspunten: 3 bars vs doel voor de gekozen week/maand
 * (leads · geplande afspraken · sales).
 *
 * - Leads = gegenereerd in gekozen periode / nodig voor resterende slots
 *   (capaciteit − al ingepland) ÷ L→A-rate 14d
 * - Afspraken = ingepland in periode / slots (100% van capaciteit)
 * - Sales = getekend in periode / doel (25% van afspraken-nodig)
 *
 * Toekomstige periode: actuals = 0, doelen blijven die van díe week/maand.
 */

import { addDays, addWeeks, getDaysInMonth, getISOWeekYear } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import {
  loadAfblokkingen,
  loadSlotVrijgaven,
  weekKeyString,
} from "@/lib/adviseur-beschikbaarheid";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  CEO_CLOSE_TARGET_PCT,
  leadsNeededForForwardHorizon,
} from "@/lib/ceo-unit-targets";
import { countPlanbareSlotsBreakdown } from "@/lib/dashboard-v2/capacity";
import { buildSalesRapportage } from "@/lib/sales-rapportage";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import {
  formatSchouwWeekLabel,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";

/** L→A lookback (conversie-rate); slots/leads zelf volgen de gekozen periode */
const LEADS_LOOKBACK_DAYS = 14;
/** Afspraken-doel op de key-3 balk: alle open slots volplannen */
const AFSPRAAK_FILL_TARGET_PCT = 100;

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
  /** Toelichting leads-balk */
  leadsMeta: {
    l2aPct: number;
    slotsOpen: number;
    targetAppts: number;
    /** Dagen in gekozen periode */
    periodDays: number;
    lookbackDays: number;
    saleClosePct: number;
  };
  /** Agenda: ingepland vs alle planbare slots in gekozen periode */
  afsprakenMeta: {
    /** Rooster-capaciteit (zonder persoonlijke afblokkingen) */
    slotsCapaciteit: number;
    /** Nog boekbaar na afblokkingen */
    slotsOpen: number;
    slotsAfgeblokt: number;
    slotsGepland: number;
    slotsVrij: number;
    periodDays: number;
    fillTargetPct: number;
  };
  /** Per planbare adviseur, G→S hoog → laag. */
  afsprakenPerAdviseur: AandachtAfspraakAdviseur[];
  /** Venster waarop G→S is berekend */
  afsprakenConversieLabel: string;
};

export type AandachtAfspraakAdviseur = {
  id: string;
  naam: string;
  gepland: number;
  capaciteit: number;
  /** capaciteit − al ingepland */
  nog: number;
  /** sales / gelopen, in procenten */
  conversiePct: number | null;
  gelopen: number;
  sales: number;
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

/** Zelfde venster als Sales: 12 weken t/m de gekozen week, afgekapt op vandaag. */
async function loadGsPerAdviseur(
  sb: SupabaseClient,
  opts: { anchorMondayYmd: string; todayYmd: string; now: Date }
): Promise<{
  byId: Map<string, { gelopen: number; sales: number; pct: number | null }>;
  label: string;
}> {
  const startYmd = ymdAmsterdam(addWeeks(noonYmd(opts.anchorMondayYmd), -11));
  let endYmd = ymdAmsterdam(addDays(noonYmd(opts.anchorMondayYmd), 6));
  if (endYmd > opts.todayYmd) endYmd = opts.todayYmd;
  const rapport = await buildSalesRapportage(
    sb,
    startYmd,
    endYmd,
    opts.now
  );
  const byId = new Map<
    string,
    { gelopen: number; sales: number; pct: number | null }
  >();
  for (const week of rapport.series) {
    for (const row of week.adviseurs) {
      const cur = byId.get(row.key) || { gelopen: 0, sales: 0, pct: null };
      cur.gelopen += row.gelopen;
      cur.sales += row.sales;
      byId.set(row.key, cur);
    }
  }
  for (const cur of byId.values()) {
    cur.pct =
      cur.gelopen > 0
        ? Math.round((cur.sales / cur.gelopen) * 1000) / 10
        : null;
  }
  const tot = formatInTimeZone(noonYmd(endYmd), AMSTERDAM_TZ, "d MMM", {
    locale: nl,
  });
  return { byId, label: `G→S hoog → laag · 12 weken t/m ${tot}` };
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

  // Actuals t/m vandaag; toekomstige periode → 0 gegenereerd/sales
  const countEndYmd = range.endYmd > todayYmd ? todayYmd : range.endYmd;
  const periodFullyFuture = range.startYmd > todayYmd;
  const { start: fromDate } = amsBounds(range.startYmd);
  const { end: toDate } = amsBounds(countEndYmd);
  const { end: periodEndDate } = amsBounds(range.endYmd);

  const yStart = getISOWeekYear(
    toZonedTime(noonYmd(range.startYmd), AMSTERDAM_TZ)
  );
  const yEnd = getISOWeekYear(toZonedTime(noonYmd(range.endYmd), AMSTERDAM_TZ));
  const jaren = [...new Set([yStart - 1, yStart, yEnd, yEnd + 1])];

  const [
    { data: adviseursRaw },
    leadsInPeriod,
    afsprakenOpAgenda,
    offertes,
  ] = await Promise.all([
    sb
      .from("adviseurs")
      .select("id, naam, email, rol, actief, startdatum")
      .eq("actief", true),
    // Alleen leads met created_at in de gekozen periode (t/m vandaag)
    periodFullyFuture
      ? Promise.resolve(
          [] as {
            id: string;
            created_at: string;
            adviseur_id: string | null;
          }[]
        )
      : fetchAllRows<{
          id: string;
          created_at: string;
          adviseur_id: string | null;
        }>((fromIdx, toIdx) =>
          sb
            .from("leads")
            .select("id, created_at, adviseur_id")
            .gte("created_at", fromDate.toISOString())
            .lte("created_at", toDate.toISOString())
            .order("created_at", { ascending: true })
            .range(fromIdx, toIdx)
        ),
    // Huisbezoeken op de agenda in de hele periode (ook toekomst)
    fetchAllRows<{
      id: string;
      start_at: string;
      status: string;
      soort: string | null;
      adviseur_id: string | null;
    }>((fromIdx, toIdx) =>
      sb
        .from("afspraken")
        .select("id, start_at, status, soort, adviseur_id")
        .gte("start_at", fromDate.toISOString())
        .lte("start_at", periodEndDate.toISOString())
        .neq("status", "geannuleerd")
        .order("start_at", { ascending: true })
        .range(fromIdx, toIdx)
    ),
    periodFullyFuture
      ? Promise.resolve(
          [] as { id: string; ondertekend_op: string | null }[]
        )
      : fetchAllRows<{ id: string; ondertekend_op: string | null }>(
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

  // L→A uit recente 14d (stabiele rate); slots/doelen volgen gekozen periode
  const leadNeedRef = await leadsNeededForForwardHorizon(sb, {
    todayYmd,
    forwardDays: LEADS_LOOKBACK_DAYS,
    lookbackDays: LEADS_LOOKBACK_DAYS,
    adviseursCap,
    unavailableByAdviseur,
  });
  const l2aPct = leadNeedRef.l2aPct;

  // —— Afspraken: alle planbare slots (capaciteit) + ingepland in periode ——
  const periodAppts = afsprakenOpAgenda.filter(
    (a) =>
      isNieuweHuisbezoek(a) &&
      inYmdRange(a.start_at, range.startYmd, range.endYmd)
  );
  const slotsBreak = countPlanbareSlotsBreakdown({
    startYmd: range.startYmd,
    endYmd: range.endYmd,
    adviseurs: adviseursCap,
    unavailableByAdviseur,
    afblokkingen,
    vrijgaven,
  });
  // Doel = álle rooster-slots die die week open stonden (niet “nog vrij”)
  const slotsCapaciteit = slotsBreak.capaciteit;
  const slotsOpenAppt = slotsBreak.open;
  const slotsAfgebloktAppt = slotsBreak.afgeblokt;
  const slotsGeplandAppt = periodAppts.length;
  const slotsVrijAppt = Math.max(0, slotsOpenAppt - slotsGeplandAppt);
  const targetAppt = Math.ceil(
    slotsCapaciteit * (AFSPRAAK_FILL_TARGET_PCT / 100)
  );
  // Leads alleen voor wat nog gevuld moet worden (232 − 84 = 148).
  const slotsResterend = Math.max(0, slotsCapaciteit - slotsGeplandAppt);

  const geplandPerAdviseur = new Map<string, number>();
  for (const a of periodAppts) {
    const id = (a.adviseur_id || "").trim();
    if (!id) continue;
    geplandPerAdviseur.set(id, (geplandPerAdviseur.get(id) || 0) + 1);
  }
  const naamById = new Map(
    (adviseursRaw || []).map(
      (a) => [a.id as string, (a.naam as string) || "Adviseur"] as const
    )
  );
  const gs = await loadGsPerAdviseur(sb, {
    anchorMondayYmd:
      opts.mode === "week"
        ? range.startYmd
        : String(
            schouwWeekToMondayIso(
              schouwWeekFromDate(noonYmd(todayYmd)).jaar,
              schouwWeekFromDate(noonYmd(todayYmd)).week
            )
          ).slice(0, 10),
    todayYmd,
    now,
  });

  function rowFor(adv: {
    id: string;
    naam: string;
    capaciteit: number;
    gepland: number;
  }): AandachtAfspraakAdviseur {
    const stat = gs.byId.get(adv.id);
    const gelopen = stat?.gelopen ?? 0;
    const sales = stat?.sales ?? 0;
    return {
      id: adv.id,
      naam: adv.naam,
      gepland: adv.gepland,
      capaciteit: adv.capaciteit,
      nog: Math.max(0, adv.capaciteit - adv.gepland),
      conversiePct: stat?.pct ?? null,
      gelopen,
      sales,
    };
  }

  const metRooster: AandachtAfspraakAdviseur[] = slotsBreak.perAdviseur.map(
    (adv) =>
      rowFor({
        id: adv.id,
        naam: adv.naam,
        capaciteit: adv.capaciteit,
        gepland: geplandPerAdviseur.get(adv.id) || 0,
      })
  );
  const roosterIds = new Set(metRooster.map((a) => a.id));
  const zonderRooster: AandachtAfspraakAdviseur[] = [];
  for (const [id, gepland] of geplandPerAdviseur) {
    if (roosterIds.has(id) || gepland <= 0) continue;
    zonderRooster.push(
      rowFor({
        id,
        naam: naamById.get(id) || "Adviseur",
        capaciteit: 0,
        gepland,
      })
    );
  }
  const afsprakenPerAdviseur = [...metRooster, ...zonderRooster].sort(
    (a, b) =>
      (b.conversiePct ?? -1) - (a.conversiePct ?? -1) ||
      b.sales - a.sales ||
      b.gelopen - a.gelopen ||
      a.naam.localeCompare(b.naam, "nl")
  );
  const afsprakenConversieLabel = gs.label;

  // —— Leads: gegenereerd in díe periode vs nodig voor resterende slots ——
  const targetLeads =
    l2aPct > 0 ? Math.ceil(slotsResterend / (l2aPct / 100)) : 0;
  const leadsActual = periodFullyFuture
    ? 0
    : leadsInPeriod.filter((l) =>
        inYmdRange(l.created_at, range.startYmd, countEndYmd)
      ).length;

  // —— Sales: getekend vs 25% van afspraken-nodig in periode ——
  const targetSales = Math.round(
    (targetAppt * CEO_CLOSE_TARGET_PCT) / 100
  );
  const salesActual = offertes.filter((o) =>
    inYmdRange(o.ondertekend_op, range.startYmd, countEndYmd)
  ).length;

  const daysElapsed = periodFullyFuture
    ? 0
    : Math.max(
        1,
        Math.round(
          (noonYmd(countEndYmd).getTime() -
            noonYmd(range.startYmd).getTime()) /
            86_400_000
        ) + 1
      );
  const paceFrac = periodFullyFuture
    ? 1
    : Math.min(1, daysElapsed / range.daysInPeriod);

  function bar(
    id: AandachtBarId,
    label: string,
    unitLabel: string,
    actual: number,
    target: number,
    opts?: { paceFrac?: number; onTrack?: boolean }
  ): AandachtBar {
    const frac = opts?.paceFrac ?? paceFrac;
    const paceTarget =
      target <= 0 ? 0 : Math.max(1, Math.round(target * frac));
    return {
      id,
      label,
      unitLabel,
      actual,
      target,
      paceTarget,
      onTrack: opts?.onTrack ?? (target <= 0 ? actual >= 0 : actual >= paceTarget),
    };
  }

  const periodUnit = opts.mode === "month" ? "maand" : "week";

  return {
    mode: opts.mode,
    periodLabel: range.periodLabel,
    startYmd: range.startYmd,
    endYmd: range.endYmd,
    todayYmd,
    leadsMeta: {
      l2aPct,
      slotsOpen: slotsResterend,
      targetAppts: slotsResterend,
      periodDays: range.daysInPeriod,
      lookbackDays: LEADS_LOOKBACK_DAYS,
      saleClosePct: CEO_CLOSE_TARGET_PCT,
    },
    afsprakenMeta: {
      slotsCapaciteit,
      slotsOpen: slotsOpenAppt,
      slotsAfgeblokt: slotsAfgebloktAppt,
      slotsGepland: slotsGeplandAppt,
      slotsVrij: slotsVrijAppt,
      periodDays: range.daysInPeriod,
      fillTargetPct: AFSPRAAK_FILL_TARGET_PCT,
    },
    afsprakenPerAdviseur,
    afsprakenConversieLabel,
    bars: [
      bar(
        "leads",
        "Leads",
        `Gen. / nodig · ${periodUnit}`,
        leadsActual,
        targetLeads,
        {
          paceFrac: 1,
          onTrack: leadsActual >= targetLeads,
        }
      ),
      bar(
        "afspraken",
        "Geplande afspraken",
        "Ingepland / alle slots",
        slotsGeplandAppt,
        targetAppt,
        {
          paceFrac: 1,
          onTrack: slotsGeplandAppt >= targetAppt,
        }
      ),
      bar(
        "sales",
        "Sales",
        `Sales (${CEO_CLOSE_TARGET_PCT}% doel)`,
        salesActual,
        targetSales,
        {
          // Toekomstige week: doel volledig tonen; actual 0 → niet “op schema”
          paceFrac: periodFullyFuture ? 1 : paceFrac,
          onTrack: periodFullyFuture
            ? salesActual >= targetSales
            : undefined,
        }
      ),
    ],
  };
}

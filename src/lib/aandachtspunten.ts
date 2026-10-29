/**
 * Simpele aandachtspunten: 3 bars huidig vs doel (leads · geplande afspraken · sales).
 * Leads = gegenereerd 14d / nodig (slots 14d × 80% ÷ L→A 14d).
 * Afspraken = ingepland / beschikbare blokken (komende ~14d); op schema bij ≥80% vol.
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
import { DEFAULT_AFSPRAAK_TO_SALE_PCT } from "@/lib/admin-targets";
import {
  CEO_FILL_TARGET_PCT,
  leadsNeededForForwardHorizon,
} from "@/lib/ceo-unit-targets";
import {
  buildDashboardV2Capacity,
  countOpenSlotsInYmdRange,
} from "@/lib/dashboard-v2/capacity";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import {
  formatSchouwWeekLabel,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";

/** Horizon voor leads-doel / breakdown */
const LEADS_FORWARD_DAYS = 14;
const LEADS_LOOKBACK_DAYS = 14;

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

export type AandachtLeadAdviseurRow = {
  adviseurId: string;
  naam: string;
  /** Open slots komende 14 dagen */
  slotsOpen: number;
  /** Leads nodig komende 14d (slots×80% ÷ team L→A) */
  leadsNodig: number;
  /** Leads gegenereerd afgelopen 14d (op deze adviseur) */
  leadsGegenereerd: number;
};

export type AandachtAfspraakAdviseurRow = {
  adviseurId: string;
  naam: string;
  /** Beschikbare blokken in horizon */
  slotsOpen: number;
  /** Al ingepland */
  ingepland: number;
  /** Nodig = 80% van slotsOpen */
  nodig: number;
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
    forwardDays: number;
    lookbackDays: number;
  };
  /** Agenda: ingepland vs beschikbare blokken (zelfde 14d-horizon) */
  afsprakenMeta: {
    slotsOpen: number;
    slotsGepland: number;
    slotsVrij: number;
    forwardDays: number;
    fillTargetPct: number;
  };
  leadsPerAdviseur: AandachtLeadAdviseurRow[];
  afsprakenPerAdviseur: AandachtAfspraakAdviseurRow[];
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

  const lookbackStartYmd = ymdAmsterdam(
    addDays(noonYmd(todayYmd), -(LEADS_LOOKBACK_DAYS - 1))
  );
  const { start: lookbackStartDate } = amsBounds(lookbackStartYmd);
  const { end: todayEndDate } = amsBounds(todayYmd);

  const [
    { data: adviseursRaw },
    leads14d,
    afsprakenOpAgenda,
    offertes,
  ] = await Promise.all([
      sb
        .from("adviseurs")
        .select("id, naam, email, rol, actief, startdatum")
        .eq("actief", true),
      // Leads afgelopen 14d (team actual + per-adviseur breakdown)
      fetchAllRows<{
        id: string;
        created_at: string;
        adviseur_id: string | null;
      }>((fromIdx, toIdx) =>
        sb
          .from("leads")
          .select("id, created_at, adviseur_id")
          .gte("created_at", lookbackStartDate.toISOString())
          .lte("created_at", todayEndDate.toISOString())
          .order("created_at", { ascending: true })
          .range(fromIdx, toIdx)
      ),
      // Sales-basis + historisch per adviseur: huisbezoeken op de agenda
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

  // Capaciteit: geselecteerde periode + (voor actueel tempo) komende ~2 weken
  const fwdEndYmd = ymdAmsterdam(
    addDays(noonYmd(todayYmd), LEADS_FORWARD_DAYS - 1)
  );
  const horizonEndYmd = ymdAmsterdam(addDays(now, 14));
  const capTotYmd =
    horizonEndYmd > range.endYmd
      ? horizonEndYmd > fwdEndYmd
        ? horizonEndYmd
        : fwdEndYmd
      : range.endYmd > fwdEndYmd
        ? range.endYmd
        : fwdEndYmd;

  const [unavailableByAdviseur, afblokkingen, vrijgaven, afsprakenCapRes] =
    await Promise.all([
      loadUnavailableByAdviseur(sb, adviseurIds, jaren),
      loadAfblokkingen(sb, {
        adviseurIds,
        van: range.startYmd < todayYmd ? range.startYmd : todayYmd,
        tot: capTotYmd,
      }),
      loadSlotVrijgaven(sb, {
        adviseurIds,
        van: range.startYmd < todayYmd ? range.startYmd : todayYmd,
        tot: capTotYmd,
      }),
      sb
        .from("afspraken")
        .select("adviseur_id, start_at, end_at, status, soort")
        .in("adviseur_id", adviseurIds)
        .gte("start_at", amsBounds(todayYmd).start.toISOString())
        .lte("start_at", amsBounds(fwdEndYmd).end.toISOString())
        .neq("status", "geannuleerd"),
    ]);

  const leadNeed = await leadsNeededForForwardHorizon(sb, {
    todayYmd,
    forwardDays: LEADS_FORWARD_DAYS,
    lookbackDays: LEADS_LOOKBACK_DAYS,
    adviseursCap,
    unavailableByAdviseur,
  });
  const targetLeads = leadNeed.targetLeads;
  const l2aPct = leadNeed.l2aPct;

  // Agenda 14d: beschikbare blokken vs al ingepland
  const isCurrentOrFuturePeriod = range.endYmd >= todayYmd;
  const capacityAfspraken = (afsprakenCapRes.data || []).map((a) => ({
    adviseur_id: (a.adviseur_id as string) || null,
    start_at: a.start_at as string,
    end_at: (a.end_at as string | null) ?? null,
    status: a.status as string,
    soort: (a.soort as string | null) ?? null,
  }));

  let slotsOpenAppt = 0;
  let slotsGeplandAppt = 0;
  let slotsVrijAppt = 0;
  let afsprakenPerAdviseur: AandachtAfspraakAdviseurRow[] = [];
  if (isCurrentOrFuturePeriod) {
    const capacity = buildDashboardV2Capacity({
      adviseurs: adviseursCap,
      afspraken: capacityAfspraken,
      unavailableByAdviseur,
      afblokkingen,
      vrijgaven,
      weeksAhead: 2,
      now,
      weekdaysOnly: false,
      skipCurrentIsoWeek: false,
      includeToday: true,
    });
    slotsOpenAppt = capacity.slotsOpen;
    slotsGeplandAppt = capacity.slotsGepland;
    slotsVrijAppt = capacity.slotsVrij;
    afsprakenPerAdviseur = capacity.adviseurs
      .map((a) => {
        const nodig = Math.ceil(
          Math.max(0, a.slotsOpen) * (CEO_FILL_TARGET_PCT / 100)
        );
        return {
          adviseurId: a.id,
          naam: a.naam,
          slotsOpen: a.slotsOpen,
          ingepland: a.slotsGepland,
          nodig,
        };
      })
      .filter((r) => r.slotsOpen > 0 || r.ingepland > 0)
      .sort(
        (a, b) =>
          b.nodig - a.nodig ||
          b.ingepland - a.ingepland ||
          a.naam.localeCompare(b.naam, "nl")
      );
  } else {
    slotsOpenAppt = countOpenSlotsInYmdRange({
      startYmd: range.startYmd,
      endYmd: range.endYmd,
      adviseurs: adviseursCap,
      unavailableByAdviseur,
      afblokkingen,
      vrijgaven,
    });
    // Historisch: huisbezoeken op de agenda in die periode
    const histAppts = afsprakenOpAgenda.filter(
      (a) =>
        isNieuweHuisbezoek(a) &&
        inYmdRange(a.start_at, range.startYmd, range.endYmd)
    );
    slotsGeplandAppt = histAppts.length;
    slotsVrijAppt = Math.max(0, slotsOpenAppt - slotsGeplandAppt);
    const geplandByAdv = new Map<string, number>();
    for (const a of histAppts) {
      const aid = a.adviseur_id;
      if (!aid) continue;
      geplandByAdv.set(aid, (geplandByAdv.get(aid) || 0) + 1);
    }
    afsprakenPerAdviseur = adviseursCap
      .map((adv) => {
        const slotsOpen = countOpenSlotsInYmdRange({
          startYmd: range.startYmd,
          endYmd: range.endYmd,
          adviseurs: [adv],
          unavailableByAdviseur,
          afblokkingen,
          vrijgaven,
        });
        const nodig = Math.ceil(
          Math.max(0, slotsOpen) * (CEO_FILL_TARGET_PCT / 100)
        );
        return {
          adviseurId: adv.id,
          naam: adv.naam,
          slotsOpen,
          ingepland: geplandByAdv.get(adv.id) || 0,
          nodig,
        };
      })
      .filter((r) => r.slotsOpen > 0 || r.ingepland > 0)
      .sort(
        (a, b) =>
          b.nodig - a.nodig ||
          b.ingepland - a.ingepland ||
          a.naam.localeCompare(b.naam, "nl")
      );
  }

  // Zitten / nodig: ingepland vs 80% van beschikbare blokken
  const apptActual = slotsGeplandAppt;
  const targetAppt = Math.ceil(
    slotsOpenAppt * (CEO_FILL_TARGET_PCT / 100)
  );

  const daysElapsed = Math.max(
    1,
    Math.round(
      (noonYmd(countEndYmd).getTime() - noonYmd(range.startYmd).getTime()) /
        86_400_000
    ) + 1
  );
  const paceFrac = Math.min(1, daysElapsed / range.daysInPeriod);

  // Leads: afgelopen 14d gegenereerd vs nodig voor agenda komende 14d
  const leadsActual = leads14d.length;
  const generatedByAdviseur = new Map<string, number>();
  for (const l of leads14d) {
    const aid = l.adviseur_id;
    if (!aid) continue;
    generatedByAdviseur.set(aid, (generatedByAdviseur.get(aid) || 0) + 1);
  }

  const leadsPerAdviseur: AandachtLeadAdviseurRow[] = adviseursCap
    .map((adv) => {
      const slotsOpen = countOpenSlotsInYmdRange({
        startYmd: todayYmd,
        endYmd: fwdEndYmd,
        adviseurs: [adv],
        unavailableByAdviseur,
        afblokkingen,
        vrijgaven,
      });
      const targetApptsAdv = Math.ceil(
        Math.max(0, slotsOpen) * (CEO_FILL_TARGET_PCT / 100)
      );
      const leadsNodig =
        l2aPct > 0 ? Math.ceil(targetApptsAdv / (l2aPct / 100)) : 0;
      return {
        adviseurId: adv.id,
        naam: adv.naam,
        slotsOpen,
        leadsNodig,
        leadsGegenereerd: generatedByAdviseur.get(adv.id) || 0,
      };
    })
    .filter((r) => r.slotsOpen > 0 || r.leadsGegenereerd > 0 || r.leadsNodig > 0)
    .sort(
      (a, b) =>
        b.leadsNodig - a.leadsNodig ||
        b.leadsGegenereerd - a.leadsGegenereerd ||
        a.naam.localeCompare(b.naam, "nl")
    );

  // Leads zonder (planbare) adviseur: tellen wel mee in teamtotaal, niet per persoon
  const onPlanbaar = leadsPerAdviseur.reduce(
    (s, r) => s + r.leadsGegenereerd,
    0
  );
  const restGegenereerd = Math.max(0, leadsActual - onPlanbaar);
  if (restGegenereerd > 0) {
    leadsPerAdviseur.push({
      adviseurId: "_unassigned",
      naam: "Nog niet op een adviseur",
      slotsOpen: 0,
      leadsNodig: 0,
      leadsGegenereerd: restGegenereerd,
    });
  }

  // Afspraken op de agenda in deze week/maand (hele periode) → sales-doel
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
    target: number,
    opts?: { paceFrac?: number; onTrack?: boolean }
  ): AandachtBar {
    const frac = opts?.paceFrac ?? paceFrac;
    const paceTarget = Math.max(1, Math.round(target * frac));
    return {
      id,
      label,
      unitLabel,
      actual,
      target,
      paceTarget,
      onTrack: opts?.onTrack ?? actual >= paceTarget,
    };
  }

  return {
    mode: opts.mode,
    periodLabel: range.periodLabel,
    startYmd: range.startYmd,
    endYmd: range.endYmd,
    todayYmd,
    leadsMeta: {
      l2aPct,
      slotsOpen: leadNeed.slotsOpen,
      targetAppts: leadNeed.targetAppts,
      forwardDays: LEADS_FORWARD_DAYS,
      lookbackDays: LEADS_LOOKBACK_DAYS,
    },
    afsprakenMeta: {
      slotsOpen: slotsOpenAppt,
      slotsGepland: slotsGeplandAppt,
      slotsVrij: slotsVrijAppt,
      forwardDays: LEADS_FORWARD_DAYS,
      fillTargetPct: CEO_FILL_TARGET_PCT,
    },
    leadsPerAdviseur,
    afsprakenPerAdviseur,
    bars: [
      bar("leads", "Leads", "14d gen. / nodig", leadsActual, targetLeads, {
        paceFrac: 1,
        onTrack: leadsActual >= targetLeads,
      }),
      bar(
        "afspraken",
        "Geplande afspraken",
        "Ingepland / nodig",
        apptActual,
        targetAppt,
        {
          paceFrac: 1,
          onTrack: apptActual >= targetAppt,
        }
      ),
      bar("sales", "Sales", "Sales", salesActual, targetSales),
    ],
  };
}

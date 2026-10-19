import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { addDays, getISOWeekYear } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";
import {
  buildBelConversie,
  buildBelConversieTargets,
  huisbezoekLeadIdsOpDag,
  inAmsterdamDayRange,
  isHuisbezoekAfspraak,
  todayAmsterdamYmd,
  type BelConversieAfspraak,
  type BelConversieCpa,
  type BelConversieLead,
} from "@/lib/bel-conversie";
import {
  parseConversiePeriod,
  resolveConversiePeriod,
} from "@/lib/conversie-period";
import {
  DEFAULT_TARGETS,
  parseAdminTargetsStore,
  resolvePersonTargets,
} from "@/lib/admin-targets";
import {
  dayKeyAmsterdam,
  loadAfblokkingen,
  loadSlotVrijgaven,
  weekKeyString,
} from "@/lib/adviseur-beschikbaarheid";
import { buildDashboardV2Capacity } from "@/lib/dashboard-v2";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  amsterdamDayKey,
  MAX_BELPOGINGEN,
  MAX_BELPOGINGEN_PER_DAG,
} from "@/lib/bel-queue";
import { META_LEAD_CAMPAIGN_ID } from "@/lib/meta-ads-spend";
import {
  schouwWeekFromDate,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";

export const runtime = "nodejs";

type Sb = ReturnType<typeof getSupabaseAdmin>;

function amsDayBounds(ymd: string): { start: Date; end: Date } {
  const [y, m, d] = ymd.split("-").map(Number);
  return {
    start: fromZonedTime(new Date(y, m - 1, d, 0, 0, 0, 0), AMSTERDAM_TZ),
    end: fromZonedTime(new Date(y, m - 1, d, 23, 59, 59, 999), AMSTERDAM_TZ),
  };
}

function shiftAmsterdamYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
  return amsterdamDayKey(addDays(noon, deltaDays));
}

function isoWeekRangeYmd(ymd: string): { start: string; end: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  const info = schouwWeekFromDate(
    fromZonedTime(new Date(y, m - 1, d, 12, 0, 0), AMSTERDAM_TZ)
  );
  const start = String(schouwWeekToMondayIso(info.jaar, info.week)).slice(0, 10);
  const end = shiftAmsterdamYmd(start, 6);
  return { start, end };
}

function parseCpaDays(raw: string | null): 7 | 14 | 30 {
  const n = Number(raw);
  if (n === 14 || n === 30) return n;
  return 7;
}

async function loadBelConversieCpa(
  sb: Sb,
  endYmd: string,
  days: 7 | 14 | 30
): Promise<BelConversieCpa> {
  const startYmd = shiftAmsterdamYmd(endYmd, -(days - 1));
  const { start } = amsDayBounds(startYmd);
  const { end } = amsDayBounds(endYmd);

  const [metaRes, kostenRes, afsRes] = await Promise.all([
    sb
      .from("meta_ad_spend")
      .select("spend, datum, level, campaign_id")
      .eq("level", "campaign")
      .eq("campaign_id", META_LEAD_CAMPAIGN_ID)
      .gte("datum", startYmd)
      .lte("datum", endYmd),
    sb
      .from("rapportage_kosten")
      .select("bedrag, datum, soort")
      .eq("soort", "ad_spend")
      .gte("datum", startYmd)
      .lte("datum", endYmd),
    sb
      .from("afspraken")
      .select("id, lead_id, created_at, start_at, status, soort")
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString()),
  ]);

  let adSpend = 0;
  const metaRows = metaRes.error ? [] : metaRes.data || [];
  if (metaRows.length > 0) {
    for (const row of metaRows) {
      adSpend += Number(row.spend) || 0;
    }
  } else if (!kostenRes.error) {
    for (const row of kostenRes.data || []) {
      adSpend += Number(row.bedrag) || 0;
    }
  }
  adSpend = Math.round(adSpend * 100) / 100;

  let afsprakenGepland = 0;
  if (!afsRes.error) {
    const afsRows = (afsRes.data || []) as BelConversieAfspraak[];
    const leadIds = [
      ...new Set(
        afsRows
          .filter((a) => (a.soort || "").trim() === "nieuw")
          .map((a) => a.lead_id)
      ),
    ];
    let historie = afsRows;
    if (leadIds.length > 0) {
      const { data: hist } = await sb
        .from("afspraken")
        .select("id, lead_id, created_at, start_at, status, soort")
        .eq("soort", "nieuw")
        .in("lead_id", leadIds);
      if (hist) historie = hist as BelConversieAfspraak[];
    }
    afsprakenGepland = huisbezoekLeadIdsOpDag(
      afsRows,
      start,
      end,
      historie
    ).size;
  }

  const costPerAppointment =
    afsprakenGepland > 0
      ? Math.round((adSpend / afsprakenGepland) * 100) / 100
      : null;

  return {
    days,
    rangeStart: startYmd,
    rangeEnd: endYmd,
    adSpend,
    afsprakenGepland,
    costPerAppointment,
  };
}

async function loadGoalsRaw(sb: Sb): Promise<unknown> {
  const { data, error } = await sb
    .from("dashboard_instellingen")
    .select("dashboard_v2_doelen")
    .eq("actief", true)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (
      error.code === "42703" ||
      error.message?.includes("dashboard_v2_doelen")
    ) {
      return {};
    }
    return {};
  }
  return data?.dashboard_v2_doelen ?? {};
}

async function loadUnavailableByAdviseur(
  sb: Sb,
  adviseurIds: string[],
  jaren: number[]
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (adviseurIds.length === 0 || jaren.length === 0) return map;
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
    const id = row.adviseur_id as string;
    const set = map.get(id) || new Set<string>();
    set.add(weekKeyString(Number(row.jaar), Number(row.week)));
    map.set(id, set);
  }
  return map;
}

/** Som weekdoelen afspraken + L2A% voor actieve bellers (backoffice telt als beller). */
function belTeamWeeklyTargets(
  goalsRaw: unknown,
  adviseurs: { id: string; rol?: string | null; actief?: boolean }[]
): { weeklyAfspraken: number; leadToAppt: number } {
  const store = parseAdminTargetsStore(goalsRaw);
  const callers = adviseurs.filter((a) => {
    if (a.actief === false) return false;
    const r = normalizeRol(a.rol);
    return r === "beller" || r === "backoffice";
  });
  const base = store.defaults.beller || DEFAULT_TARGETS.beller;
  if (callers.length === 0) {
    return {
      weeklyAfspraken: base.afsprakenGepland,
      leadToAppt: base.leadToAppt,
    };
  }
  let weeklyAfspraken = 0;
  let l2aSum = 0;
  for (const c of callers) {
    const { effective } = resolvePersonTargets(store, "beller", c.id);
    weeklyAfspraken += effective.afsprakenGepland;
    l2aSum += effective.leadToAppt;
  }
  return {
    weeklyAfspraken,
    leadToAppt: Math.round((l2aSum / callers.length) * 10) / 10,
  };
}

function parseYmdParam(raw: string | null): string | null {
  const v = (raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

/**
 * GET /api/rapportage/bel-conversie?period=…|&from=&to=
 * Optioneel from+to (Amsterdam yyyy-MM-dd) overschrijft period.
 * Dagoel blijft altijd live stand van vandaag; week/periode-teller volgt het filter.
 */
export async function GET(req: NextRequest) {
  const period = parseConversiePeriod(
    req.nextUrl.searchParams.get("period")
  );
  const resolved = resolveConversiePeriod(period);
  const todayYmd = todayAmsterdamYmd();
  const fromParam = parseYmdParam(req.nextUrl.searchParams.get("from"));
  const toParam = parseYmdParam(req.nextUrl.searchParams.get("to"));
  const customRange = Boolean(
    fromParam && toParam && fromParam <= toParam
  );
  const rangeStartYmd = customRange
    ? (fromParam as string)
    : resolved.startYmd;
  const dateYmd = customRange ? (toParam as string) : resolved.endYmd;
  // Van=tot=vandaag: team/verdiensten = vandaag, weekkaart blijft ISO-week (geen periode-schaling).
  const isTodayOnlyRange =
    customRange && rangeStartYmd === dateYmd && rangeStartYmd === todayYmd;
  const periodDays = customRange
    ? Math.max(
        1,
        Math.round(
          (amsDayBounds(dateYmd).start.getTime() -
            amsDayBounds(rangeStartYmd).start.getTime()) /
            86_400_000
        ) + 1
      )
    : resolved.days;
  const periodLabel = customRange
    ? rangeStartYmd === dateYmd
      ? rangeStartYmd === todayYmd
        ? "Vandaag"
        : rangeStartYmd
      : `${rangeStartYmd} → ${dateYmd}`
    : resolved.label;
  const cpaDaysRaw = req.nextUrl.searchParams.get("cpaDays");
  const cpaDays = cpaDaysRaw
    ? parseCpaDays(cpaDaysRaw)
    : periodDays <= 7
      ? 7
      : periodDays <= 14
        ? 14
        : 30;

  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    const sessionId = session?.adviseurId || null;
    const sessionRol = normalizeRol(session?.rol);

    const sb = getSupabaseAdmin();
    const { start } = amsDayBounds(rangeStartYmd);
    const { end } = amsDayBounds(dateYmd);
    const padStart = new Date(start.getTime() - 12 * 3600 * 1000).toISOString();
    const padEnd = new Date(end.getTime() + 12 * 3600 * 1000).toISOString();

    const [leadsFull, afsprakenDagRes, adviseursRes, goalsRaw] =
      await Promise.all([
        sb
          .from("leads")
          .select(
            "id, naam, lead_number, status, postcode, laatst_gebeld_at, laatst_gebeld_door, bel_claimed_by, beller_id"
          )
          .gte("laatst_gebeld_at", padStart)
          .lte("laatst_gebeld_at", padEnd),
        sb
          .from("afspraken")
          .select(
            "id, lead_id, created_at, start_at, status, soort, adviseur_id, ingepland_door_id"
          )
          .gte("created_at", padStart)
          .lte("created_at", padEnd),
        sb
          .from("adviseurs")
          .select("id, naam, rol, actief, email, startdatum")
          .eq("actief", true)
          .order("naam"),
        loadGoalsRaw(sb),
      ]);

    let leadsRows: BelConversieLead[] = (leadsFull.data ||
      []) as BelConversieLead[];
    if (leadsFull.error) {
      const missingDoor =
        leadsFull.error.message?.includes("laatst_gebeld_door") ||
        leadsFull.error.code === "42703";
      if (!missingDoor) throw leadsFull.error;
      const retry = await sb
        .from("leads")
        .select(
          "id, naam, lead_number, status, postcode, laatst_gebeld_at, bel_claimed_by, beller_id"
        )
        .gte("laatst_gebeld_at", padStart)
        .lte("laatst_gebeld_at", padEnd);
      if (retry.error) throw retry.error;
      leadsRows = (retry.data || []).map((l) => ({
        ...(l as BelConversieLead),
        laatst_gebeld_door: null,
      }));
    }

    let afsprakenDag = (afsprakenDagRes.data || []) as BelConversieAfspraak[];
    if (
      afsprakenDagRes.error &&
      (afsprakenDagRes.error.message?.includes("ingepland_door_id") ||
        afsprakenDagRes.error.code === "42703")
    ) {
      const retryAfs = await sb
        .from("afspraken")
        .select(
          "id, lead_id, created_at, start_at, status, soort, adviseur_id"
        )
        .gte("created_at", padStart)
        .lte("created_at", padEnd);
      if (retryAfs.error) throw retryAfs.error;
      afsprakenDag = (retryAfs.data || []) as BelConversieAfspraak[];
    } else if (afsprakenDagRes.error) {
      throw afsprakenDagRes.error;
    }
    if (adviseursRes.error) throw adviseursRes.error;

    const adviseurRows = (adviseursRes.data || []).map((a) => ({
      id: a.id as string,
      naam: a.naam as string,
      rol: (a as { rol?: string | null }).rol ?? null,
      actief: Boolean(a.actief),
      email: (a as { email?: string | null }).email ?? null,
      startdatum: (a as { startdatum?: string | null }).startdatum ?? null,
    }));
    // Historie: alle nieuw-huisbezoeken van leads in deze periode → 2e bezoek / bijklant uitsluiten
    const periodeNieuwLeadIds = [
      ...new Set(
        afsprakenDag
          .filter((a) => (a.soort || "").trim() === "nieuw")
          .map((a) => a.lead_id)
      ),
    ];
    let huisbezoekHistorie = afsprakenDag;
    if (periodeNieuwLeadIds.length > 0) {
      const { data: histRows, error: histErr } = await sb
        .from("afspraken")
        .select(
          "id, lead_id, created_at, start_at, status, soort, adviseur_id, ingepland_door_id"
        )
        .eq("soort", "nieuw")
        .in("lead_id", periodeNieuwLeadIds);
      if (!histErr && histRows) {
        huisbezoekHistorie = histRows as BelConversieAfspraak[];
      }
    }

    const huisbezoekIds = huisbezoekLeadIdsOpDag(
      afsprakenDag,
      start,
      end,
      huisbezoekHistorie
    );

    const missingLeadIds = [...huisbezoekIds].filter(
      (id) => !leadsRows.some((l) => l.id === id)
    );
    if (missingLeadIds.length > 0) {
      const { data: extra, error: extraErr } = await sb
        .from("leads")
        .select(
          "id, naam, lead_number, status, postcode, laatst_gebeld_at, laatst_gebeld_door, bel_claimed_by, beller_id"
        )
        .in("id", missingLeadIds);
      if (!extraErr && extra) {
        leadsRows = leadsRows.concat(extra as BelConversieLead[]);
      }
    }

    // Solo actieve beller → orphans (geen door/claim) krijgen die credit.
    const activeBellers = adviseurRows.filter((a) => {
      if (!a.actief) return false;
      const rol = normalizeRol(a.rol);
      if (rol === "admin") return false;
      return rol === "beller";
    });
    const fallbackBellerId =
      activeBellers.length === 1 ? activeBellers[0].id : null;

    for (const l of leadsRows) {
      const door = (l.laatst_gebeld_door || "").trim();
      const claim = (l.bel_claimed_by || "").trim();
      const bellerId = (l.beller_id || "").trim();
      const appt = afsprakenDag.find(
        (a) => a.lead_id === l.id && isHuisbezoekAfspraak(a)
      );
      const ingeplandDoor = (
        (appt as { ingepland_door_id?: string | null } | undefined)
          ?.ingepland_door_id || ""
      ).trim();

      // Heal ontbrekende door: planner → claim → beller_id → solo-beller
      const healDoor =
        ingeplandDoor || claim || bellerId || fallbackBellerId || "";
      const needsDoor = !door && Boolean(healDoor);
      const needsAt =
        huisbezoekIds.has(l.id) &&
        !inAmsterdamDayRange(l.laatst_gebeld_at, start, end);
      if (!needsDoor && !needsAt) continue;

      const patch: Record<string, unknown> = {};
      if (needsDoor) patch.laatst_gebeld_door = healDoor;
      if (needsAt) {
        patch.laatst_gebeld_at = appt?.created_at || end.toISOString();
      }
      if (Object.keys(patch).length === 0) continue;

      const { error: upErr } = await sb.from("leads").update(patch).eq("id", l.id);
      if (!upErr) {
        if ("laatst_gebeld_door" in patch) {
          l.laatst_gebeld_door =
            typeof patch.laatst_gebeld_door === "string"
              ? patch.laatst_gebeld_door
              : null;
        }
        if (typeof patch.laatst_gebeld_at === "string") {
          l.laatst_gebeld_at = patch.laatst_gebeld_at;
        }
      }
    }

    const leadIds = leadsRows.map((l) => l.id);
    let afspraken = afsprakenDag;
    if (leadIds.length > 0) {
      const chunk = 200;
      const extra: BelConversieAfspraak[] = [];
      for (let i = 0; i < leadIds.length; i += chunk) {
        const slice = leadIds.slice(i, i + chunk);
        const { data, error } = await sb
          .from("afspraken")
          .select(
            "id, lead_id, created_at, start_at, status, soort, adviseur_id, ingepland_door_id"
          )
          .in("lead_id", slice);
        if (error) throw error;
        extra.push(...((data || []) as BelConversieAfspraak[]));
      }
      const seen = new Set(afspraken.map((a) => a.id));
      for (const a of extra) {
        if (!seen.has(a.id)) afspraken.push(a);
      }
    }

    const teamTargets = belTeamWeeklyTargets(goalsRaw, adviseurRows);

    // Belbare leads: nog niet definitief afgeboekt (geen_contact telt wél mee)
    const BELBAAR_STATUSES = [
      "nieuw",
      "geen_contact",
      "vervolg_geen_contact",
    ] as const;
    let leadsBelbaarTotaal = 0;
    let leadsBelbaarVandaag = 0;
    try {
      const { data: belbareRows } = await sb
        .from("leads")
        .select(
          "id, status, telefoon, belpogingen, belpogingen_vandaag, laatst_gebeld_at"
        )
        .in("status", [...BELBAAR_STATUSES]);
      for (const l of belbareRows || []) {
        if (!(l.telefoon || "").trim()) continue;
        const pogingen = Math.max(0, Number(l.belpogingen) || 0);
        if (pogingen >= MAX_BELPOGINGEN) continue;
        leadsBelbaarTotaal += 1;
        const calledToday =
          l.laatst_gebeld_at &&
          amsterdamDayKey(l.laatst_gebeld_at) === todayYmd;
        const pogingenDag = calledToday
          ? Math.max(0, Number(l.belpogingen_vandaag) || 1)
          : 0;
        if (pogingenDag < MAX_BELPOGINGEN_PER_DAG) {
          leadsBelbaarVandaag += 1;
        }
      }
    } catch {
      leadsBelbaarTotaal = 0;
      leadsBelbaarVandaag = 0;
    }

    // Actuele L→A over laatste 7 dagen t/m gekozen datum (bel-conversie-definitie)
    let leadToApptActueel: number | null = null;
    try {
      const [y, m, d] = dateYmd.split("-").map(Number);
      const endDay = fromZonedTime(
        new Date(y, m - 1, d, 23, 59, 59, 999),
        AMSTERDAM_TZ
      );
      const startDay = fromZonedTime(
        new Date(y, m - 1, d - 6, 0, 0, 0, 0),
        AMSTERDAM_TZ
      );
      const [gebeld7, afs7] = await Promise.all([
        sb
          .from("leads")
          .select("id")
          .gte("laatst_gebeld_at", startDay.toISOString())
          .lte("laatst_gebeld_at", endDay.toISOString()),
        sb
          .from("afspraken")
          .select("id, lead_id, created_at, start_at, status, soort")
          .gte("created_at", startDay.toISOString())
          .lte("created_at", endDay.toISOString()),
      ]);
      const gebeldIds = new Set((gebeld7.data || []).map((l) => l.id as string));
      const afs7Rows = (afs7.data || []) as BelConversieAfspraak[];
      const leadIds7 = [
        ...new Set(
          afs7Rows
            .filter((a) => (a.soort || "").trim() === "nieuw")
            .map((a) => a.lead_id)
        ),
      ];
      let hist7 = afs7Rows;
      if (leadIds7.length > 0) {
        const { data: h7 } = await sb
          .from("afspraken")
          .select("id, lead_id, created_at, start_at, status, soort")
          .eq("soort", "nieuw")
          .in("lead_id", leadIds7);
        if (h7) hist7 = h7 as BelConversieAfspraak[];
      }
      const ingeplandIds = huisbezoekLeadIdsOpDag(
        afs7Rows,
        startDay,
        endDay,
        hist7
      );
      for (const id of ingeplandIds) gebeldIds.add(id);
      const gebeldN = gebeldIds.size;
      const ingeplandN = ingeplandIds.size;
      if (gebeldN > 0) {
        leadToApptActueel =
          Math.round((ingeplandN / gebeldN) * 1000) / 10;
      }
    } catch {
      leadToApptActueel = null;
    }

    // Dagoel = altijd live stand van vandaag (filter wijzigt dit niet).
    // Weekstand = huidige ISO-week t/m vandaag (tenzij custom range → periode-teller).
    let geplandVandaag = 0;
    let geplandDezeWeek = 0;
    try {
      const { start: dayStart } = amsDayBounds(todayYmd);
      const { end: dayEnd } = amsDayBounds(todayYmd);
      const weekRange = isoWeekRangeYmd(todayYmd);
      const { start: weekStart } = amsDayBounds(weekRange.start);
      const weekEndYmd =
        todayYmd < weekRange.end ? todayYmd : weekRange.end;
      const { end: weekEnd } = amsDayBounds(weekEndYmd);
      const { data: afsOps, error: afsOpsErr } = await sb
        .from("afspraken")
        .select("id, lead_id, created_at, start_at, status, soort")
        .gte("created_at", weekStart.toISOString())
        .lte("created_at", dayEnd.toISOString());
      if (!afsOpsErr) {
        const afsOpsRows = (afsOps || []) as BelConversieAfspraak[];
        const opsLeadIds = [
          ...new Set(
            afsOpsRows
              .filter((a) => (a.soort || "").trim() === "nieuw")
              .map((a) => a.lead_id)
          ),
        ];
        let opsHist = afsOpsRows;
        if (opsLeadIds.length > 0) {
          const { data: oh } = await sb
            .from("afspraken")
            .select("id, lead_id, created_at, start_at, status, soort")
            .eq("soort", "nieuw")
            .in("lead_id", opsLeadIds);
          if (oh) opsHist = oh as BelConversieAfspraak[];
        }
        geplandVandaag = huisbezoekLeadIdsOpDag(
          afsOpsRows,
          dayStart,
          dayEnd,
          opsHist
        ).size;
        geplandDezeWeek = huisbezoekLeadIdsOpDag(
          afsOpsRows,
          weekStart,
          weekEnd,
          opsHist
        ).size;
      }
    } catch {
      geplandVandaag = 0;
      geplandDezeWeek = 0;
    }

    // Capaciteit: deze week + 2 weken vooruit → dagoel met 20% marge
    let horizon: {
      weeksAhead: number;
      slotsVrij: number;
      slotsGepland: number;
      slotsOpen: number;
      label: string;
      weeks: {
        jaar: number;
        week: number;
        label: string;
        slotsVrij: number;
        slotsGepland: number;
        slotsOpen: number;
      }[];
    } | null = null;
    let leadToApptDoel = teamTargets.leadToAppt;
    try {
      const now = new Date();
      // Deze week (rest) + 2 weken vooruit
      const weeksAhead = 3;
      const daysAhead = weeksAhead * 7 + 7;
      const van = dayKeyAmsterdam(now);
      const tot = dayKeyAmsterdam(addDays(now, daysAhead + 2));
      const y = getISOWeekYear(toZonedTime(now, AMSTERDAM_TZ));
      const adviseurIds = adviseurRows.map((a) => a.id);

      const [unavailableByAdviseur, afblokkingen, vrijgaven, afsprakenCapRes] =
        await Promise.all([
          loadUnavailableByAdviseur(sb, adviseurIds, [y - 1, y, y + 1]),
          loadAfblokkingen(sb, { adviseurIds, van, tot }),
          loadSlotVrijgaven(sb, { adviseurIds, van, tot }),
          sb
            .from("afspraken")
            .select("adviseur_id, start_at, end_at, status, soort")
            .gte("start_at", now.toISOString())
            .lte(
              "start_at",
              addDays(now, daysAhead + 2).toISOString()
            )
            .neq("status", "geannuleerd"),
        ]);

      const l2aFrac =
        leadToApptActueel != null && leadToApptActueel > 0
          ? leadToApptActueel / 100
          : teamTargets.leadToAppt / 100;

      const capacity = buildDashboardV2Capacity({
        adviseurs: adviseurRows,
        afspraken: (afsprakenCapRes.data || []).map((a) => ({
          adviseur_id: (a.adviseur_id as string) || null,
          start_at: a.start_at as string,
          end_at: (a.end_at as string | null) ?? null,
          status: a.status as string,
          soort: (a.soort as string | null) ?? null,
        })),
        unavailableByAdviseur,
        afblokkingen,
        vrijgaven,
        weeksAhead,
        now,
        // Incl. rest huidige week (vanaf vandaag) + za; geen skip van huidige week
        weekdaysOnly: false,
        skipCurrentIsoWeek: false,
        includeToday: true,
        targetLeadToAppt: l2aFrac,
        l2aSampleLeads: leadToApptActueel != null ? 1 : 0,
        l2aSampleAfspraken: leadToApptActueel != null ? 1 : 0,
      });

      if (capacity.l2aFromRecent || capacity.slotsVrij > 0) {
        leadToApptDoel =
          Math.round(capacity.targetLeadToAppt * 1000) / 10;
      }

      const weekLabels = capacity.weeks.map((w) => w.label).filter(Boolean);
      horizon = {
        weeksAhead,
        slotsVrij: capacity.slotsVrij,
        slotsGepland: capacity.slotsGepland,
        slotsOpen: capacity.slotsOpen,
        label:
          weekLabels.length > 0
            ? weekLabels.join(" · ")
            : `Deze week + 2 weken vooruit`,
        weeks: capacity.weeks.map((w) => ({
          jaar: w.jaar,
          week: w.week,
          label: w.label,
          slotsVrij: w.slotsVrij,
          slotsGepland: w.slotsGepland,
          slotsOpen: w.slotsOpen,
        })),
      };
    } catch {
      horizon = null;
    }

    // Bij custom range (niet alleen vandaag): week-kaart = netto in de gekozen periode.
    // Dag-kaart blijft altijd vandaag (geplandVandaag hierboven).
    const geplandVoorWeekKaart =
      customRange && !isTodayOnlyRange
        ? huisbezoekIds.size
        : geplandDezeWeek;

    const targets = buildBelConversieTargets({
      geplandVandaag,
      geplandDezeWeek: geplandVoorWeekKaart,
      leadToApptDoel,
      fromYmd: todayYmd,
      horizon,
      weeklyAfsprakenDoelFallback: teamTargets.weeklyAfspraken,
      leadToApptActueel,
      leadsBelbaarTotaal,
      leadsBelbaarVandaag,
    });

    // Custom range (niet vandaag-only): weekdoel schalen op bel-werkdagen in het filter
    if (customRange && !isTodayOnlyRange) {
      const { countWeekdaysInclusive } = await import("@/lib/bel-conversie");
      const workdays = Math.max(
        1,
        countWeekdaysInclusive(rangeStartYmd, dateYmd)
      );
      const periodeDoel =
        targets.doelVandaag > 0
          ? targets.doelVandaag * workdays
          : targets.doelDezeWeek;
      targets.doelDezeWeek = periodeDoel;
      targets.geplandDezeWeek = geplandVoorWeekKaart;
      targets.nogDezeWeek = Math.max(0, periodeDoel - geplandVoorWeekKaart);
      targets.pctDezeWeek =
        periodeDoel > 0
          ? Math.min(
              100,
              Math.round((geplandVoorWeekKaart / periodeDoel) * 100)
            )
          : geplandVoorWeekKaart > 0
            ? 100
            : 0;
      targets.finishDezeWeek =
        periodeDoel > 0 ? geplandVoorWeekKaart >= periodeDoel : false;
      targets.resterendeWerkdagenWeek = workdays;
    }

    const cpa = await loadBelConversieCpa(sb, dateYmd, cpaDays);
    const result = buildBelConversie({
      dateYmd,
      rangeStartYmd,
      period: customRange ? "last_7_days" : resolved.period,
      periodLabel,
      periodDays,
      leads: leadsRows,
      afspraken,
      huisbezoekHistorie,
      adviseurs: adviseurRows,
      fallbackBellerId,
      targets,
      geplandVandaagForTargets: geplandVandaag,
      geplandDezeWeekForTargets: geplandVoorWeekKaart,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      cpa,
      meta: {
        sessionRol,
        fallbackBellerId,
        weeklyAfsprakenDoel: teamTargets.weeklyAfspraken,
        period: customRange ? "custom" : resolved.period,
        periodLabel,
        periodDays,
        rangeStartYmd,
        rangeEndYmd: dateYmd,
        customRange,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Bel-conversie laden mislukt") },
      { status: 500 }
    );
  }
}

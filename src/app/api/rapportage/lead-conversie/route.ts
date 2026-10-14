import { NextRequest, NextResponse } from "next/server";
import { addDays, getISOWeekYear, startOfMonth } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  amsDayBounds,
  buildLeadConversie,
  buildSourceRows,
  inAmsterdamDayRange,
  leadToApptPct,
  normalizeLeadSource,
  todayAmsterdamYmd,
} from "@/lib/lead-conversie";
import {
  parseConversiePeriod,
  resolveConversiePeriod,
} from "@/lib/conversie-period";
import {
  dayKeyAmsterdam,
  loadAfblokkingen,
  loadSlotVrijgaven,
  weekKeyString,
} from "@/lib/adviseur-beschikbaarheid";
import { buildDashboardV2Capacity } from "@/lib/dashboard-v2";
import { AMSTERDAM_TZ } from "@/lib/format";
import { isHuisbezoekAfspraak } from "@/lib/bel-conversie";
import { normalizeProjectStatus } from "@/lib/labels";
import { META_LEAD_CAMPAIGN_ID } from "@/lib/meta-ads-spend";
import { schouwWeekFromDate, schouwWeekToMondayIso } from "@/lib/schouw-week";

export const runtime = "nodejs";

type Sb = ReturnType<typeof getSupabaseAdmin>;

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

function shiftAmsterdamYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
  return dayKeyAmsterdam(addDays(noon, deltaDays));
}

function isoWeekRangeYmd(ymd: string): { start: string; end: string } {
  const info = schouwWeekFromDate(
    fromZonedTime(
      (() => {
        const [y, m, d] = ymd.split("-").map(Number);
        return new Date(y, m - 1, d, 12, 0, 0);
      })(),
      AMSTERDAM_TZ
    )
  );
  const mondayRaw = schouwWeekToMondayIso(info.jaar, info.week);
  const start = String(mondayRaw).slice(0, 10);
  const end = shiftAmsterdamYmd(start, 6);
  return { start, end };
}

function monthRangeYmd(ymd: string): { start: string; end: string } {
  const [y, m] = ymd.split("-").map(Number);
  const startLocal = startOfMonth(new Date(y, m - 1, 1));
  const start = dayKeyAmsterdam(
    fromZonedTime(
      new Date(
        startLocal.getFullYear(),
        startLocal.getMonth(),
        startLocal.getDate(),
        12,
        0,
        0
      ),
      AMSTERDAM_TZ
    )
  );
  const last = new Date(y, m, 0);
  const end = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  return { start, end };
}

function weekOverlapsRange(
  jaar: number,
  week: number,
  rangeStart: string,
  rangeEnd: string
): boolean {
  const mon = String(schouwWeekToMondayIso(jaar, week)).slice(0, 10);
  const sun = shiftAmsterdamYmd(mon, 6);
  return mon <= rangeEnd && sun >= rangeStart;
}

/**
 * GET /api/rapportage/lead-conversie?period=…
 * Targets = altijd op schema voor komende 14d (L→A = afgelopen 14d).
 * `period` stuurt alleen Per kanaal (leads/CPL/deals/CPA).
 */
export async function GET(req: NextRequest) {
  const channelPeriod = parseConversiePeriod(
    req.nextUrl.searchParams.get("period")
  );
  const channelResolved = resolveConversiePeriod(channelPeriod);
  const todayYmd = todayAmsterdamYmd();
  // Vast L→A-venster voor targets (schema komende 14 dagen)
  const l2aFixed = resolveConversiePeriod("last_14_days");

  try {
    const sb = getSupabaseAdmin();
    const biweeklyEndYmd = shiftAmsterdamYmd(todayYmd, 13);
    const { start: targetL2aStart } = amsDayBounds(l2aFixed.startYmd);
    const { end: targetL2aEnd } = amsDayBounds(l2aFixed.endYmd);
    const { start: channelStart } = amsDayBounds(channelResolved.startYmd);
    const { end: channelEnd } = amsDayBounds(channelResolved.endYmd);

    // Finishlijnen: kalender t.o.v. vandaag (operationeel)
    const weekRange = isoWeekRangeYmd(todayYmd);
    const monthRange = monthRangeYmd(todayYmd);
    const { start: dayStart } = amsDayBounds(todayYmd);
    const { end: dayEnd } = amsDayBounds(todayYmd);
    const { start: weekStart } = amsDayBounds(weekRange.start);
    const { end: weekEnd } = amsDayBounds(weekRange.end);
    const { start: monthStart } = amsDayBounds(monthRange.start);
    const { end: monthEnd } = amsDayBounds(monthRange.end);
    // Bi-weekly voortgang = leads laatste 14d (tempo vs komende 2 wkn-doel)
    const biLeadsStartYmd = shiftAmsterdamYmd(todayYmd, -13);
    const { start: biStart } = amsDayBounds(biLeadsStartYmd);
    const { end: biEnd } = amsDayBounds(todayYmd);

    const earliestMs = Math.min(
      targetL2aStart.getTime(),
      channelStart.getTime(),
      monthStart.getTime(),
      biStart.getTime()
    );
    const latestMs = Math.max(
      targetL2aEnd.getTime(),
      channelEnd.getTime(),
      dayEnd.getTime()
    );
    const earliest = new Date(earliestMs);
    const latest = new Date(latestMs);

    const [leadsRes, afsRes, adviseursRes, metaSpendRes, kostenRes] =
      await Promise.all([
        sb
          .from("leads")
          .select("id, created_at, bron, utm_source, lander, status")
          .gte("created_at", earliest.toISOString())
          .lte("created_at", latest.toISOString()),
        sb
          .from("afspraken")
          .select("id, lead_id, created_at, start_at, status, soort")
          .gte("created_at", earliest.toISOString())
          .lte("created_at", latest.toISOString()),
        sb
          .from("adviseurs")
          .select("id, naam, rol, actief, email, startdatum")
          .eq("actief", true)
          .order("naam"),
        sb
          .from("meta_ad_spend")
          .select("spend, datum, level, campaign_id")
          .eq("level", "campaign")
          .eq("campaign_id", META_LEAD_CAMPAIGN_ID)
          .gte("datum", channelResolved.startYmd)
          .lte("datum", channelResolved.endYmd),
        sb
          .from("rapportage_kosten")
          .select("bedrag, datum, soort")
          .eq("soort", "ad_spend")
          .gte("datum", channelResolved.startYmd)
          .lte("datum", channelResolved.endYmd),
      ]);

    if (leadsRes.error) throw leadsRes.error;
    if (afsRes.error) throw afsRes.error;
    if (adviseursRes.error) throw adviseursRes.error;

    const adviseurRows = (adviseursRes.data || []).map((a) => ({
      id: a.id as string,
      naam: a.naam as string,
      rol: (a as { rol?: string | null }).rol ?? null,
      actief: Boolean(a.actief),
      email: (a as { email?: string | null }).email ?? null,
      startdatum: (a as { startdatum?: string | null }).startdatum ?? null,
    }));

    type LeadRow = {
      id: string;
      created_at: string;
      bron?: string | null;
      utm_source?: string | null;
      lander?: string | null;
      status?: string | null;
    };
    const allLeads = (leadsRes.data || []) as LeadRow[];

    let targetL2aLeads = 0;
    let leadsDag = 0;
    let leadsWeek = 0;
    let leadsMaand = 0;
    let leadsBiweekly = 0;
    const channelLeadRows: LeadRow[] = [];
    for (const l of allLeads) {
      const at = l.created_at;
      if (inAmsterdamDayRange(at, targetL2aStart, targetL2aEnd)) {
        targetL2aLeads += 1;
      }
      if (inAmsterdamDayRange(at, channelStart, channelEnd)) {
        channelLeadRows.push(l);
      }
      if (inAmsterdamDayRange(at, dayStart, dayEnd)) leadsDag += 1;
      if (inAmsterdamDayRange(at, weekStart, weekEnd)) leadsWeek += 1;
      if (inAmsterdamDayRange(at, monthStart, monthEnd)) leadsMaand += 1;
      if (inAmsterdamDayRange(at, biStart, biEnd)) leadsBiweekly += 1;
    }

    const channelAfspraakLeadIds = new Set<string>();
    let targetL2aAfspraken = 0;
    for (const a of afsRes.data || []) {
      if (
        !isHuisbezoekAfspraak({
          id: a.id as string,
          lead_id: a.lead_id as string,
          created_at: (a.created_at as string) || null,
          start_at: a.start_at as string,
          status: (a.status as string) || null,
          soort: (a.soort as string) || null,
        })
      ) {
        continue;
      }
      const at = (a.created_at as string) || (a.start_at as string);
      if (inAmsterdamDayRange(at, targetL2aStart, targetL2aEnd)) {
        targetL2aAfspraken += 1;
      }
      if (inAmsterdamDayRange(at, channelStart, channelEnd)) {
        channelAfspraakLeadIds.add(a.lead_id as string);
      }
    }

    // Targets: L→A altijd afgelopen 14 dagen
    const l2a = leadToApptPct(targetL2aAfspraken, targetL2aLeads);

    // Per kanaal: spend in gekozen filterperiode
    let metaSpend = 0;
    const metaRows = metaSpendRes.error ? [] : metaSpendRes.data || [];
    if (metaRows.length > 0) {
      for (const row of metaRows) {
        metaSpend += Number(row.spend) || 0;
      }
    } else if (!kostenRes.error) {
      for (const row of kostenRes.data || []) {
        metaSpend += Number(row.bedrag) || 0;
      }
    }
    metaSpend = Math.round(metaSpend * 100) / 100;

    // Netto sales Per kanaal = getekend in de periode (ondertekend_op),
    // per lead-bron (utm fb/ig → Meta). Niet alleen leads die in de periode
    // binnenkwamen — anders mist Meta bijna alle deals.
    const dealsBySource: Record<string, number> = {};
    {
      const { data: offertes, error: offErr } = await sb
        .from("offertes")
        .select("id, lead_id, status, ondertekend_op")
        .not("ondertekend_op", "is", null)
        .gte("ondertekend_op", channelStart.toISOString())
        .lte("ondertekend_op", channelEnd.toISOString());
      if (offErr) throw offErr;

      const offerteIds = (offertes || [])
        .map((o) => o.id as string)
        .filter(Boolean);
      const cancelledOfferteIds = new Set<string>();
      if (offerteIds.length > 0) {
        const chunk = 200;
        for (let i = 0; i < offerteIds.length; i += chunk) {
          const slice = offerteIds.slice(i, i + chunk);
          const { data: projs } = await sb
            .from("projecten")
            .select("offerte_id, status")
            .in("offerte_id", slice);
          for (const p of projs || []) {
            const oid = (p as { offerte_id?: string | null }).offerte_id;
            if (!oid) continue;
            if (
              normalizeProjectStatus(
                (p as { status?: string | null }).status
              ) === "annulering"
            ) {
              cancelledOfferteIds.add(oid);
            }
          }
        }
      }

      const dealLeadIds: string[] = [];
      const seenDealLeads = new Set<string>();
      for (const o of offertes || []) {
        const oid = o.id as string;
        const status = String(o.status || "").toLowerCase();
        if (status === "afgewezen") continue;
        if (cancelledOfferteIds.has(oid)) continue;
        // Heeft ondertekend_op → telt als getekend (status meestal ondertekend)
        if (status && status !== "ondertekend" && status !== "getekend") {
          continue;
        }
        const lid = (o.lead_id as string) || "";
        if (!lid || seenDealLeads.has(lid)) continue;
        seenDealLeads.add(lid);
        dealLeadIds.push(lid);
      }

      const dealLeadById = new Map<string, LeadRow>();
      if (dealLeadIds.length > 0) {
        const chunk = 200;
        for (let i = 0; i < dealLeadIds.length; i += chunk) {
          const slice = dealLeadIds.slice(i, i + chunk);
          const { data: extra, error: extraErr } = await sb
            .from("leads")
            .select("id, created_at, bron, utm_source, lander, status")
            .in("id", slice);
          if (extraErr) throw extraErr;
          for (const row of (extra || []) as LeadRow[]) {
            dealLeadById.set(row.id, row);
          }
        }
      }
      for (const lid of dealLeadIds) {
        const lead = dealLeadById.get(lid);
        const source = normalizeLeadSource(lead || {});
        dealsBySource[source] = (dealsBySource[source] || 0) + 1;
      }
    }

    // Afspraken Per kanaal = huisbezoeken *ingepland* in de periode
    // (niet alleen leads die ook in die periode binnenkwamen). Incl. vandaag.
    const channelApptLeadIds: string[] = [];
    for (const a of afsRes.data || []) {
      if (
        !isHuisbezoekAfspraak({
          id: a.id as string,
          lead_id: a.lead_id as string,
          created_at: (a.created_at as string) || null,
          start_at: a.start_at as string,
          status: (a.status as string) || null,
          soort: (a.soort as string) || null,
        })
      ) {
        continue;
      }
      const at = (a.created_at as string) || (a.start_at as string);
      if (!inAmsterdamDayRange(at, channelStart, channelEnd)) continue;
      channelApptLeadIds.push(a.lead_id as string);
    }
    const knownLeads = new Map(allLeads.map((l) => [l.id, l] as const));
    const missingApptLeadIds = [
      ...new Set(channelApptLeadIds.filter((id) => id && !knownLeads.has(id))),
    ];
    if (missingApptLeadIds.length > 0) {
      const chunk = 200;
      for (let i = 0; i < missingApptLeadIds.length; i += chunk) {
        const slice = missingApptLeadIds.slice(i, i + chunk);
        const { data: extra, error: extraErr } = await sb
          .from("leads")
          .select("id, created_at, bron, utm_source, lander, status")
          .in("id", slice);
        if (extraErr) throw extraErr;
        for (const row of (extra || []) as LeadRow[]) {
          knownLeads.set(row.id, row);
        }
      }
    }
    const afsprakenBySource: Record<string, number> = {};
    for (const leadId of channelApptLeadIds) {
      const lead = knownLeads.get(leadId);
      const source = normalizeLeadSource(lead || {});
      afsprakenBySource[source] = (afsprakenBySource[source] || 0) + 1;
    }

    const bySource = buildSourceRows(
      channelLeadRows,
      channelAfspraakLeadIds,
      { Meta: metaSpend },
      new Set(),
      afsprakenBySource,
      dealsBySource
    );

    // Capaciteit: genoeg weken voor rest van de maand + 2 weken
    let slotsOpenMaand = 0;
    let slotsOpenWeek = 0;
    let slotsOpenBiweekly = 0;
    let horizonWeeks: {
      jaar: number;
      week: number;
      label: string;
      slotsOpen: number;
      slotsVrij: number;
    }[] = [];

    try {
      const now = new Date();
      const weeksAhead = 8;
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
            .lte("start_at", addDays(now, daysAhead + 2).toISOString())
            .neq("status", "geannuleerd"),
        ]);

      const l2aFrac = l2a != null && l2a > 0 ? l2a / 100 : 0.25;

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
        weekdaysOnly: false,
        skipCurrentIsoWeek: false,
        includeToday: true,
        targetLeadToAppt: l2aFrac,
        l2aSampleLeads: targetL2aLeads,
        l2aSampleAfspraken: targetL2aAfspraken,
      });

      horizonWeeks = capacity.weeks.map((w) => ({
        jaar: w.jaar,
        week: w.week,
        label: w.label,
        slotsOpen: w.slotsOpen,
        slotsVrij: w.slotsVrij,
      }));

      const maandFrom = todayYmd;
      const maandTo = monthRange.end;
      const weekFrom = weekRange.start;
      const weekTo = weekRange.end;
      const biFrom = todayYmd;
      const biTo = biweeklyEndYmd;

      for (const w of capacity.weeks) {
        if (weekOverlapsRange(w.jaar, w.week, maandFrom, maandTo)) {
          slotsOpenMaand += w.slotsOpen;
        }
        if (weekOverlapsRange(w.jaar, w.week, weekFrom, weekTo)) {
          slotsOpenWeek += w.slotsOpen;
        }
        if (weekOverlapsRange(w.jaar, w.week, biFrom, biTo)) {
          slotsOpenBiweekly += w.slotsOpen;
        }
      }
    } catch {
      slotsOpenMaand = 0;
      slotsOpenWeek = 0;
      slotsOpenBiweekly = 0;
      horizonWeeks = [];
    }

    const result = buildLeadConversie({
      dateYmd: todayYmd,
      leadToApptActueel: l2a,
      l2aLeads: targetL2aLeads,
      l2aAfspraken: targetL2aAfspraken,
      l2aWindowDays: l2aFixed.days,
      slotsOpenMaand,
      slotsOpenWeek,
      slotsOpenBiweekly,
      horizonWeeks,
      leadsDag,
      leadsWeek,
      leadsMaand,
      leadsBiweekly,
      weekStartYmd: weekRange.start,
      weekEndYmd: weekRange.end,
      monthStartYmd: monthRange.start,
      monthEndYmd: monthRange.end,
      biweeklyCapStartYmd: todayYmd,
      biweeklyCapEndYmd: biweeklyEndYmd,
      biweeklyLeadsStartYmd: biLeadsStartYmd,
      biweeklyLeadsEndYmd: todayYmd,
      bySource,
      metaSpend,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      period: channelResolved.period,
      periodLabel: channelResolved.label,
      periodDays: channelResolved.days,
      rangeStartYmd: channelResolved.startYmd,
      rangeEndYmd: channelResolved.endYmd,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Lead-conversie laden mislukt") },
      { status: 500 }
    );
  }
}

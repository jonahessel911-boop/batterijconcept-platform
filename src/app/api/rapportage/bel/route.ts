import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fromZonedTime } from "date-fns-tz";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";
import {
  isHuisbezoekAfspraak,
  type BelConversieAfspraak,
  type BelConversieLead,
} from "@/lib/bel-conversie";
import {
  buildBelIngeplandPipeline,
  buildBelRapportage,
  defaultBelRange,
} from "@/lib/bel-rapportage";
import { addDays } from "date-fns";
import {
  conversieMonthRangeContaining,
  conversieWeekRangeContaining,
  todayConversieYmd,
} from "@/lib/conversie-period";
import {
  parseSchouwWeekValue,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";
import { AMSTERDAM_TZ } from "@/lib/format";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

export const runtime = "nodejs";

function amsDayBounds(ymd: string): { start: Date; end: Date } {
  const [y, m, d] = ymd.split("-").map(Number);
  return {
    start: fromZonedTime(new Date(y, m - 1, d, 0, 0, 0, 0), AMSTERDAM_TZ),
    end: fromZonedTime(new Date(y, m - 1, d, 23, 59, 59, 999), AMSTERDAM_TZ),
  };
}

/**
 * GET /api/rapportage/bel
 * Query: from, to | week | month
 */
export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const sp = req.nextUrl.searchParams;
    const weekParam = sp.get("week")?.trim() || "";
    const monthParam = sp.get("month")?.trim() || "";
    let from = sp.get("from")?.trim() || "";
    let to = sp.get("to")?.trim() || "";

    if (weekParam) {
      const parsed = parseSchouwWeekValue(weekParam);
      if (parsed) {
        const mon = String(
          schouwWeekToMondayIso(parsed.jaar, parsed.week)
        ).slice(0, 10);
        const range = conversieWeekRangeContaining(mon);
        from = range.startYmd;
        to = range.endYmd;
      }
    } else if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const range = conversieMonthRangeContaining(`${monthParam}-01`);
      from = range.startYmd;
      to = range.endYmd;
    } else if (!from || !to) {
      const def = defaultBelRange();
      from = from || def.startYmd;
      to = to || def.endYmd;
    }

    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }

    const today = todayConversieYmd();
    if (to > today) to = today;

    const sessionRol = normalizeRol(session.rol);
    const lockToSelf = sessionRol === "beller";
    const bellerFilter = lockToSelf
      ? session.adviseurId
      : sp.get("beller_id")?.trim() || null;

    const sb = getSupabaseAdmin();
    const { start } = amsDayBounds(from);
    const { end } = amsDayBounds(to);
    const padStart = new Date(start.getTime() - 12 * 3600 * 1000).toISOString();
    const padEnd = new Date(end.getTime() + 12 * 3600 * 1000).toISOString();

    // Komende 14 dagen (vandaag t/m +13) voor pipeline per week
    const [ty, tm, td] = today.split("-").map(Number);
    const pipelineToDate = addDays(new Date(ty, tm - 1, td, 12, 0, 0), 13);
    const pipelineTo = [
      pipelineToDate.getFullYear(),
      String(pipelineToDate.getMonth() + 1).padStart(2, "0"),
      String(pipelineToDate.getDate()).padStart(2, "0"),
    ].join("-");
    const { start: pipelineStart } = amsDayBounds(today);
    const { end: pipelineEnd } = amsDayBounds(pipelineTo);
    const pipelinePadStart = new Date(
      pipelineStart.getTime() - 12 * 3600 * 1000
    ).toISOString();
    const pipelinePadEnd = new Date(
      pipelineEnd.getTime() + 12 * 3600 * 1000
    ).toISOString();

    const leadsSelectFull =
      "id, naam, lead_number, status, postcode, bron, utm_source, lander, campaign_name, ad_name, laatst_gebeld_at, laatst_gebeld_door, bel_claimed_by, beller_id";
    const leadsSelectBasic =
      "id, naam, lead_number, status, postcode, bron, laatst_gebeld_at, bel_claimed_by, beller_id";

    async function loadGebeldLeads(): Promise<BelConversieLead[]> {
      try {
        return await fetchAllRows<BelConversieLead>((fromIdx, toIdx) =>
          sb
            .from("leads")
            .select(leadsSelectFull)
            .gte("laatst_gebeld_at", padStart)
            .lte("laatst_gebeld_at", padEnd)
            .order("id", { ascending: true })
            .range(fromIdx, toIdx)
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = (e as { code?: string })?.code;
        const missingCol =
          msg.includes("laatst_gebeld_door") ||
          msg.includes("lander") ||
          msg.includes("campaign_name") ||
          msg.includes("ad_name") ||
          msg.includes("utm_source") ||
          code === "42703";
        if (!missingCol) throw e;
        const rows = await fetchAllRows<BelConversieLead>((fromIdx, toIdx) =>
          sb
            .from("leads")
            .select(leadsSelectBasic)
            .gte("laatst_gebeld_at", padStart)
            .lte("laatst_gebeld_at", padEnd)
            .order("id", { ascending: true })
            .range(fromIdx, toIdx)
        );
        return rows.map((l) => ({
          ...l,
          laatst_gebeld_door: null,
          utm_source: null,
          lander: null,
          campaign_name: null,
          ad_name: null,
        }));
      }
    }

    async function loadAfsprakenCreated(
      rangeStart: string,
      rangeEnd: string
    ): Promise<BelConversieAfspraak[]> {
      try {
        return await fetchAllRows<BelConversieAfspraak>((fromIdx, toIdx) =>
          sb
            .from("afspraken")
            .select(
              "id, lead_id, created_at, start_at, status, soort, adviseur_id, ingepland_door_id"
            )
            .gte("created_at", rangeStart)
            .lte("created_at", rangeEnd)
            .order("id", { ascending: true })
            .range(fromIdx, toIdx)
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = (e as { code?: string })?.code;
        if (!msg.includes("ingepland_door_id") && code !== "42703") throw e;
        return fetchAllRows<BelConversieAfspraak>((fromIdx, toIdx) =>
          sb
            .from("afspraken")
            .select(
              "id, lead_id, created_at, start_at, status, soort, adviseur_id"
            )
            .gte("created_at", rangeStart)
            .lte("created_at", rangeEnd)
            .order("id", { ascending: true })
            .range(fromIdx, toIdx)
        );
      }
    }

    async function loadPipelineAfspraken(): Promise<BelConversieAfspraak[]> {
      try {
        return await fetchAllRows<BelConversieAfspraak>((fromIdx, toIdx) =>
          sb
            .from("afspraken")
            .select(
              "id, lead_id, created_at, start_at, status, soort, adviseur_id, ingepland_door_id"
            )
            .eq("soort", "nieuw")
            .neq("status", "geannuleerd")
            .gte("start_at", pipelinePadStart)
            .lte("start_at", pipelinePadEnd)
            .order("id", { ascending: true })
            .range(fromIdx, toIdx)
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = (e as { code?: string })?.code;
        if (!msg.includes("ingepland_door_id") && code !== "42703") throw e;
        return fetchAllRows<BelConversieAfspraak>((fromIdx, toIdx) =>
          sb
            .from("afspraken")
            .select(
              "id, lead_id, created_at, start_at, status, soort, adviseur_id"
            )
            .eq("soort", "nieuw")
            .neq("status", "geannuleerd")
            .gte("start_at", pipelinePadStart)
            .lte("start_at", pipelinePadEnd)
            .order("id", { ascending: true })
            .range(fromIdx, toIdx)
        );
      }
    }

    const [leadsRows, afsprakenDag, afsprakenPipeline, adviseursRes] =
      await Promise.all([
        loadGebeldLeads(),
        loadAfsprakenCreated(padStart, padEnd),
        loadPipelineAfspraken(),
        sb
          .from("adviseurs")
          .select("id, naam, rol, actief, email")
          .eq("actief", true)
          .order("naam"),
      ]);

    if (adviseursRes.error) throw adviseursRes.error;

    let leads: BelConversieLead[] = leadsRows;
    const huisbezoekIds = new Set(
      afsprakenDag
        .filter((a) => isHuisbezoekAfspraak(a))
        .map((a) => a.lead_id)
    );
    const missingLeadIds = [...huisbezoekIds].filter(
      (id) => !leads.some((l) => l.id === id)
    );
    if (missingLeadIds.length > 0) {
      for (let i = 0; i < missingLeadIds.length; i += 200) {
        const chunk = missingLeadIds.slice(i, i + 200);
        const { data: extra } = await sb
          .from("leads")
          .select(
            "id, naam, lead_number, status, postcode, bron, utm_source, lander, campaign_name, ad_name, laatst_gebeld_at, laatst_gebeld_door, bel_claimed_by, beller_id"
          )
          .in("id", chunk);
        if (extra?.length) {
          leads = leads.concat(extra as BelConversieLead[]);
        }
      }
    }

    const periodeNieuwLeadIds = [
      ...new Set(
        afsprakenDag
          .filter((a) => (a.soort || "").trim() === "nieuw")
          .map((a) => a.lead_id)
      ),
    ];
    let huisbezoekHistorie = afsprakenDag;
    if (periodeNieuwLeadIds.length > 0) {
      const hist: BelConversieAfspraak[] = [];
      for (let i = 0; i < periodeNieuwLeadIds.length; i += 200) {
        const chunk = periodeNieuwLeadIds.slice(i, i + 200);
        const { data: histRows } = await sb
          .from("afspraken")
          .select(
            "id, lead_id, created_at, start_at, status, soort, adviseur_id, ingepland_door_id"
          )
          .eq("soort", "nieuw")
          .in("lead_id", chunk);
        if (histRows?.length) {
          hist.push(...(histRows as BelConversieAfspraak[]));
        }
      }
      if (hist.length > 0) huisbezoekHistorie = hist;
    }

    const adviseurs = (adviseursRes.data || []).map((a) => ({
      id: a.id as string,
      naam: a.naam as string,
      rol: (a as { rol?: string | null }).rol ?? null,
      actief: Boolean(a.actief),
      email: (a as { email?: string | null }).email ?? null,
    }));

    const result = buildBelRapportage({
      startYmd: from,
      endYmd: to,
      leads,
      afspraken: afsprakenDag,
      huisbezoekHistorie,
      adviseurs,
      bellerId: bellerFilter,
    });

    const pipeline14d = buildBelIngeplandPipeline({
      afspraken: afsprakenPipeline,
      days: 14,
      bookedDays: 7,
      bellerId: bellerFilter,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      pipeline14d,
      lockBeller: lockToSelf,
      bellerId: bellerFilter,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Bel laden mislukt") },
      { status: 500 }
    );
  }
}

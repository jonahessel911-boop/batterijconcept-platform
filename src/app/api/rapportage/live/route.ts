import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { isHuisbezoekAfspraak } from "@/lib/bel-conversie";
import { dayKeyAmsterdam } from "@/lib/adviseur-beschikbaarheid";
import {
  amsDayBounds,
  hoursBetween,
  liveRangeYmd,
  parseLiveDays,
  summarizeLiveRows,
  type LiveLeadRow,
} from "@/lib/live-rapportage";
import { todayAmsterdamYmd } from "@/lib/lead-conversie";

export const runtime = "nodejs";

type Sb = ReturnType<typeof getSupabaseAdmin>;

type AfspraakHit = {
  lead_id: string;
  created_at: string;
  start_at: string | null;
};

/**
 * Eerste (vroegste created_at) niet-geannuleerde huisbezoek per lead.
 */
async function loadEersteHuisbezoekPerLead(
  sb: Sb,
  leadIds: string[]
): Promise<Map<string, AfspraakHit>> {
  const out = new Map<string, AfspraakHit>();
  const unique = [...new Set(leadIds.filter(Boolean))];
  if (unique.length === 0) return out;
  const chunk = 200;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    const { data, error } = await sb
      .from("afspraken")
      .select("id, lead_id, created_at, start_at, status, soort")
      .in("lead_id", slice)
      .neq("status", "geannuleerd");
    if (error) throw error;
    for (const a of data || []) {
      const leadId = a.lead_id as string;
      if (!leadId) continue;
      if (
        !isHuisbezoekAfspraak({
          id: a.id as string,
          lead_id: leadId,
          created_at: (a.created_at as string) || null,
          start_at: (a.start_at as string) || "",
          status: (a.status as string) || null,
          soort: (a.soort as string) || null,
        })
      ) {
        continue;
      }
      const created = (a.created_at as string) || "";
      if (!created) continue;
      const prev = out.get(leadId);
      if (!prev || created < prev.created_at) {
        out.set(leadId, {
          lead_id: leadId,
          created_at: created,
          start_at: (a.start_at as string) || null,
        });
      }
    }
  }
  return out;
}

/**
 * GET /api/rapportage/live?days=1|3|7
 *
 * Cohort: leads die in de afgelopen N dagen (Amsterdam) binnenkwamen.
 * L→A = hoeveel van díe leads ooit een huisbezoek kregen.
 * "Wanneer ingepland" = afspraak.created_at van het eerste huisbezoek.
 * Oude leads die nu pas worden ingepland tellen níet mee.
 */
export async function GET(req: NextRequest) {
  const days = parseLiveDays(req.nextUrl.searchParams.get("days"));
  const todayYmd = todayAmsterdamYmd();
  const { startYmd, endYmd } = liveRangeYmd(days, todayYmd);

  try {
    const sb = getSupabaseAdmin();
    const { start } = amsDayBounds(startYmd);
    const { end } = amsDayBounds(endYmd);

    const selectFull =
      "id, naam, plaats, bron, utm_source, lander, campaign_name, ad_name, status, created_at";
    const selectLegacy = "id, naam, plaats, bron, status, created_at";

    let leadRows: Record<string, unknown>[] | null = null;
    {
      const full = await sb
        .from("leads")
        .select(selectFull)
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString())
        .order("created_at", { ascending: false });
      if (
        full.error &&
        (full.error.code === "42703" ||
          full.error.message?.includes("lander") ||
          full.error.message?.includes("campaign_name") ||
          full.error.message?.includes("ad_name") ||
          full.error.message?.includes("utm_source"))
      ) {
        const legacy = await sb
          .from("leads")
          .select(selectLegacy)
          .gte("created_at", start.toISOString())
          .lte("created_at", end.toISOString())
          .order("created_at", { ascending: false });
        if (legacy.error) throw legacy.error;
        leadRows = (legacy.data || []) as Record<string, unknown>[];
      } else if (full.error) {
        throw full.error;
      } else {
        leadRows = (full.data || []) as Record<string, unknown>[];
      }
    }

    const leads = (leadRows || []).map((l) => ({
      id: l.id as string,
      naam: (l.naam as string | null) ?? null,
      plaats: (l.plaats as string | null) ?? null,
      bron: (l.bron as string | null) ?? null,
      utm_source: (l.utm_source as string | null) ?? null,
      lander: (l.lander as string | null) ?? null,
      campaign_name: (l.campaign_name as string | null) ?? null,
      ad_name: (l.ad_name as string | null) ?? null,
      status: (l.status as string | null) ?? null,
      created_at: l.created_at as string,
    }));

    const huisbezoek = await loadEersteHuisbezoekPerLead(
      sb,
      leads.map((l) => l.id)
    );

    const rows: LiveLeadRow[] = leads.map((l) => {
      const hit = huisbezoek.get(l.id) || null;
      const createdYmd = dayKeyAmsterdam(l.created_at);
      const ingeplandAt = hit?.created_at ?? null;
      return {
        id: l.id,
        naam: (l.naam || "").trim() || "Onbekend",
        plaats: l.plaats,
        bron: l.bron,
        utm_source: l.utm_source,
        lander: l.lander,
        campaign_name: l.campaign_name,
        ad_name: l.ad_name,
        status: l.status,
        created_at: l.created_at,
        created_ymd: createdYmd,
        ingepland_at: ingeplandAt,
        ingepland_ymd: ingeplandAt ? dayKeyAmsterdam(ingeplandAt) : null,
        afspraak_start_at: hit?.start_at ?? null,
        uren_tot_ingepland: hit
          ? hoursBetween(l.created_at, hit.created_at)
          : null,
      };
    });

    return NextResponse.json(
      summarizeLiveRows(rows, days, todayYmd, startYmd, endYmd)
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e) || "Live-rapportage mislukt" },
      { status: 500 }
    );
  }
}

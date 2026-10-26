import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import {
  buildMarketingRapportage,
  defaultMarketingRange,
  type MarketingAfspraak,
  type MarketingLead,
  type MarketingMetaRow,
  type MarketingOfferte,
} from "@/lib/marketing-rapportage";
import {
  conversieMonthRangeContaining,
  conversieWeekRangeContaining,
  todayConversieYmd,
} from "@/lib/conversie-period";
import {
  metaAdsSpendConfigured,
  syncMetaAdSpendCampaignDetail,
} from "@/lib/meta-ads-spend";
import {
  parseSchouwWeekValue,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";
import { fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export const runtime = "nodejs";

/**
 * GET /api/rapportage/marketing
 * Query:
 *   from, to — yyyy-MM-dd (Amsterdam)
 *   week — 2026-W43
 *   month — 2026-10
 *   sync=1 — trigger Meta campaign sync for range (best-effort)
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
    const doSync = sp.get("sync") === "1";

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
      const def = defaultMarketingRange();
      from = from || def.startYmd;
      to = to || def.endYmd;
    }

    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }

    // Cap end at vandaag (Amsterdam) — huidige dag telt mee in spend
    const today = todayConversieYmd();
    if (to > today) to = today;

    const cfg = metaAdsSpendConfigured();
    const sb = getSupabaseAdmin();

    // Peek: oude sync had vaak 1 campagne (lead-only) → forceer account-wide sync
    let syncInfo: { upserted?: number; error?: string; forced?: boolean } | null =
      null;
    if (cfg.ok) {
      const { data: peek } = await sb
        .from("meta_ad_spend")
        .select("campaign_id")
        .eq("level", "campaign")
        .gte("datum", from)
        .lte("datum", to)
        .limit(200);
      const distinct = new Set(
        (peek || [])
          .map((r) => (r.campaign_id as string | null) || "")
          .filter(Boolean)
      );
      const needsFullSync = doSync || distinct.size <= 1;
      // Huidige dag altijd meenemen (Meta Insights live tot vandaag)
      const includesToday = to >= today;
      if (needsFullSync) {
        const synced = await syncMetaAdSpendCampaignDetail({
          since: from,
          until: to,
        });
        syncInfo = {
          upserted: synced.upserted,
          error: synced.error,
          forced: !doSync && distinct.size <= 1,
        };
      } else if (includesToday) {
        const synced = await syncMetaAdSpendCampaignDetail({
          since: today,
          until: today,
        });
        syncInfo = {
          upserted: synced.upserted,
          error: synced.error,
          forced: true,
        };
      }
    }

    const fromIso = fromZonedTime(
      (() => {
        const [y, m, d] = from.split("-").map(Number);
        return new Date(y, m - 1, d, 0, 0, 0, 0);
      })(),
      AMSTERDAM_TZ
    ).toISOString();
    const toIso = fromZonedTime(
      (() => {
        const [y, m, d] = to.split("-").map(Number);
        return new Date(y, m - 1, d, 23, 59, 59, 999);
      })(),
      AMSTERDAM_TZ
    ).toISOString();

    const [leadsInRange, offertes, afsprakenRaw, metaSpend, syncRes] =
      await Promise.all([
        fetchAllRows<MarketingLead>((fromIdx, toIdx) =>
          sb
            .from("leads")
            .select("id, created_at, campaign_name, utm_campaign")
            .gte("created_at", fromIso)
            .lte("created_at", toIso)
            .order("created_at", { ascending: true })
            .range(fromIdx, toIdx)
        ),
        fetchAllRows<MarketingOfferte>((fromIdx, toIdx) =>
          sb
            .from("offertes")
            .select("id, lead_id, status, ondertekend_op, subtotaal_ex_btw")
            .eq("status", "ondertekend")
            .not("ondertekend_op", "is", null)
            .gte("ondertekend_op", fromIso)
            .lte("ondertekend_op", toIso)
            .order("ondertekend_op", { ascending: true })
            .range(fromIdx, toIdx)
        ),
        fetchAllRows<MarketingAfspraak>((fromIdx, toIdx) =>
          sb
            .from("afspraken")
            .select("id, lead_id, created_at, start_at, status, soort")
            .gte("created_at", fromIso)
            .lte("created_at", toIso)
            .neq("status", "geannuleerd")
            .order("created_at", { ascending: true })
            .range(fromIdx, toIdx)
        ).catch(() => [] as MarketingAfspraak[]),
        fetchAllRows<MarketingMetaRow>((fromIdx, toIdx) =>
          sb
            .from("meta_ad_spend")
            .select("datum, level, campaign_id, campaign_name, spend")
            .eq("level", "campaign")
            .gte("datum", from)
            .lte("datum", to)
            .order("datum", { ascending: true })
            .range(fromIdx, toIdx)
        ).catch(() => [] as MarketingMetaRow[]),
        sb
          .from("dashboard_instellingen")
          .select("meta_laatste_sync_at")
          .eq("actief", true)
          .limit(1)
          .maybeSingle(),
      ]);

    const afspraken = afsprakenRaw;

    // Leads buiten created_at-range (deals/afspraken): campagne-key nog ophalen
    const leadIdsNeeded = new Set<string>([
      ...offertes.map((o) => o.lead_id),
      ...afspraken.map((a) => a.lead_id),
    ]);
    const knownLeadIds = new Set(leadsInRange.map((l) => l.id));
    const missingLeadIds = [...leadIdsNeeded].filter(
      (id) => !knownLeadIds.has(id)
    );
    let extraLeads: MarketingLead[] = [];
    if (missingLeadIds.length > 0) {
      // .in() max ~chunks: page in batches of 200
      for (let i = 0; i < missingLeadIds.length; i += 200) {
        const chunk = missingLeadIds.slice(i, i + 200);
        const { data: extra } = await sb
          .from("leads")
          .select("id, created_at, campaign_name, utm_campaign")
          .in("id", chunk);
        if (extra?.length) {
          extraLeads = extraLeads.concat(extra as MarketingLead[]);
        }
      }
    }

    const leads = [...leadsInRange, ...extraLeads];

    const result = buildMarketingRapportage({
      startYmd: from,
      endYmd: to,
      leads,
      offertes,
      afspraken,
      metaSpend,
      metaConfigured: cfg.ok,
      lastSyncAt:
        (syncRes.data as { meta_laatste_sync_at?: string | null } | null)
          ?.meta_laatste_sync_at || null,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      metaMissing: cfg.ok ? [] : cfg.missing,
      sync: syncInfo,
      metaCampaigns: [
        ...new Set(
          metaSpend
            .map((m) => (m.campaign_name || "").trim())
            .filter(Boolean)
        ),
      ],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Marketing laden mislukt") },
      { status: 500 }
    );
  }
}

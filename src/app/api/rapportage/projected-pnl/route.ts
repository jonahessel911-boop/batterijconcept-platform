import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import {
  buildProjectedPnl,
  defaultPnlRange,
} from "@/lib/projected-pnl";
import {
  conversieMonthRangeContaining,
  conversieWeekRangeContaining,
  todayConversieYmd,
} from "@/lib/conversie-period";
import {
  parseSchouwWeekValue,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";
import {
  metaAdsSpendConfigured,
  syncMetaAdSpendCampaignDetail,
} from "@/lib/meta-ads-spend";

export const runtime = "nodejs";

/**
 * GET /api/rapportage/projected-pnl
 * Bruto-order P&L: omzet − inkoop − installatie − commissie − ads
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
      const def = defaultPnlRange();
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

    const sb = getSupabaseAdmin();

    // Zelfde als Marketing: sync Meta campaign-spend vóór lezen,
    // anders blijft P&L op €0 terwijl Marketing wél sync’t (race op CEO-tab).
    const cfg = metaAdsSpendConfigured();
    if (cfg.ok) {
      const { data: peek } = await sb
        .from("meta_ad_spend")
        .select("campaign_id, spend")
        .eq("level", "campaign")
        .gte("datum", from)
        .lte("datum", to)
        .limit(300);
      const rows = peek || [];
      const distinct = new Set(
        rows
          .map((r) => ((r.campaign_id as string | null) || "").trim())
          .filter(Boolean)
      );
      const totalPeek = rows.reduce(
        (s, r) => s + (Number(r.spend) || 0),
        0
      );
      if (distinct.size <= 1 || totalPeek <= 0) {
        await syncMetaAdSpendCampaignDetail({ since: from, until: to });
      } else if (to >= today) {
        await syncMetaAdSpendCampaignDetail({ since: today, until: today });
      }
    }

    const result = await buildProjectedPnl(sb, from, to);

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Projected P&L laden mislukt") },
      { status: 500 }
    );
  }
}

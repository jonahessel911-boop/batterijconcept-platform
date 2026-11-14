import { NextResponse } from "next/server";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { fetchTikTokCampaignRows } from "@/lib/tiktok-ads-spend";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/cron/tiktok-ad-spend
 * Dagelijks: campagne-spend van de laatste 30 dagen.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const q = new URL(req.url).searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const until = formatInTimeZone(new Date(), "Europe/Amsterdam", "yyyy-MM-dd");
  const since = formatInTimeZone(
    subDays(new Date(), 29),
    "Europe/Amsterdam",
    "yyyy-MM-dd"
  );

  try {
    const result = await fetchTikTokCampaignRows({ since, until });
    if (!result.configured) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: result.error || "TikTok Ads niet gekoppeld",
      });
    }
    const spend = result.rows.reduce((s, r) => s + (r.spend || 0), 0);
    return NextResponse.json({
      ok: !result.error || result.rows.length > 0,
      since,
      until,
      rows: result.rows.length,
      spend: Math.round(spend * 100) / 100,
      advertisers: result.advertiserIds.length,
      error: result.error || null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "TikTok-sync mislukt" },
      { status: 500 }
    );
  }
}

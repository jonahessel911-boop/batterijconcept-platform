import { NextResponse } from "next/server";
import { syncMetaAdSpend } from "@/lib/meta-ads-spend";

export const runtime = "nodejs";

/**
 * GET /api/cron/meta-ad-spend
 * Dagelijkse sync van Meta ad spend (laatste 30 dagen) → rapportage_kosten.
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

  try {
    const result = await syncMetaAdSpend();
    if (!result.configured) {
      return NextResponse.json(
        {
          ok: false,
          skipped: true,
          reason: result.error || "Meta Ads niet geconfigureerd",
        },
        { status: 200 }
      );
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync mislukt" },
      { status: 500 }
    );
  }
}

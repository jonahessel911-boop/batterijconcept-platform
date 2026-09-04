import { NextRequest, NextResponse } from "next/server";
import {
  fetchMetaAdSpend,
  metaAdsSpendConfigured,
  syncMetaAdSpendBackfill,
  syncMetaAdSpend,
} from "@/lib/meta-ads-spend";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * GET /api/meta/ad-spend
 * Status + optionele preview van Meta ad spend (nog niet wegschrijven).
 *
 * Query:
 *   since=YYYY-MM-DD&until=YYYY-MM-DD
 *   level=account|campaign|ad  (default account)
 *   preview=1                  — haal data op als credentials gezet zijn
 */
export async function GET(req: NextRequest) {
  const cfg = metaAdsSpendConfigured();
  const params = req.nextUrl.searchParams;
  const preview = params.get("preview") === "1" || params.get("preview") === "true";
  const since = params.get("since") || undefined;
  const until = params.get("until") || undefined;
  const levelRaw = params.get("level");
  const level =
    levelRaw === "campaign" || levelRaw === "ad" ? levelRaw : "account";

  if (!preview) {
    return NextResponse.json({
      configured: cfg.ok,
      missing: cfg.missing,
      accountId: cfg.accountId,
      env: {
        META_AD_ACCOUNT_ID: "Ad account (act_… of alleen cijfers)",
        META_ADS_ACCESS_TOKEN:
          "System user / user token met ads_read (valt terug op META_CAPI_ACCESS_TOKEN)",
      },
      hint: "Voeg ?preview=1 toe om spend op te halen zonder te syncen. POST om naar rapportage_kosten te schrijven.",
    });
  }

  const result = await fetchMetaAdSpend({ since, until, level });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

/**
 * POST /api/meta/ad-spend
 * Sync Meta account-spend → rapportage_kosten (soort=ad_spend).
 *
 * Body/query:
 *   since, until, dry_run
 */
export async function POST(req: NextRequest) {
  let body: {
    since?: string;
    until?: string;
    dry_run?: boolean;
    full_sync?: boolean;
    chunk_days?: number;
    time_increment?: "1" | "7" | "monthly";
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const params = req.nextUrl.searchParams;
  const since = body.since || params.get("since") || undefined;
  const until = body.until || params.get("until") || undefined;
  const dryRun =
    body.dry_run === true ||
    params.get("dry_run") === "1" ||
    params.get("dry_run") === "true";
  const fullSync =
    body.full_sync === true ||
    params.get("full_sync") === "1" ||
    params.get("full_sync") === "true";

  if (fullSync) {
    const sb = getSupabaseAdmin();
    const [{ data: firstLead }, { data: firstOfferte }] = await Promise.all([
      sb
        .from("leads")
        .select("created_at")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      sb
        .from("offertes")
        .select("created_at")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    const autoSince =
      (firstLead?.created_at as string | undefined)?.slice(0, 10) ||
      (firstOfferte?.created_at as string | undefined)?.slice(0, 10);
    const autoUntil = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    if (!autoSince && !since) {
      return NextResponse.json(
        { error: "Geen startdatum gevonden; geef since mee" },
        { status: 400 }
      );
    }

    const result = await syncMetaAdSpendBackfill({
      since: since || autoSince!,
      until: until || autoUntil,
      dryRun,
      chunkDays: body.chunk_days || 90,
      timeIncrement: body.time_increment || "7",
      maxChunks: 30,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  const result = await syncMetaAdSpend({ since, until, dryRun });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

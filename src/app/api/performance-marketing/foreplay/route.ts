import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeRol } from "@/lib/rollen";
import { foreplayConfigured, foreplayUsage } from "@/lib/foreplay";
import {
  briefsFromRanked,
  rempromptAd,
  type TofBrief,
  type TofRegion,
} from "@/lib/tof-creative";
import {
  readForeplaySwipe,
  writeForeplaySwipe,
} from "@/lib/foreplay-swipe-store";
import { upsertCreativeItems } from "@/lib/creative-library-store";
import type { CreativeLibraryItem } from "@/lib/performance-marketing";
import { DEFAULT_LANDER } from "@/lib/tof-creative";
import { HOT_LEADGEN_NICHES } from "@/lib/hot-leadgen-niches";
import {
  readFollowedNiches,
  setFollowedNiches,
  toggleFollowedNiche,
} from "@/lib/foreplay-niches-store";
import { swipeFollowedNiches } from "@/lib/foreplay-niche-swipe";

export const runtime = "nodejs";
export const maxDuration = 90;

async function requireAdmin() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session?.adviseurId) {
    return { error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }) };
  }
  const sb = getSupabaseAdmin();
  const { data: me } = await sb
    .from("adviseurs")
    .select("rol")
    .eq("id", session.adviseurId)
    .maybeSingle();
  if (normalizeRol(me?.rol) !== "admin") {
    return { error: NextResponse.json({ error: "Alleen admin" }, { status: 403 }) };
  }
  return { ok: true as const };
}

/**
 * GET — niches + cache. ?refresh=1 swipet followed hot lead-gen niches.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const configured = foreplayConfigured();
    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    const cache = readForeplaySwipe();
    const followed = readFollowedNiches();

    if (!configured) {
      return NextResponse.json({
        configured: false,
        cache,
        niches: HOT_LEADGEN_NICHES,
        followedIds: followed.followedIds,
        usage: null,
        error: "FOREPLAY_API_KEY ontbreekt",
      });
    }

    let usage: Awaited<ReturnType<typeof foreplayUsage>> | null = null;
    try {
      usage = await foreplayUsage();
    } catch {
      usage = null;
    }

    if (!refresh && cache.winners.length > 0) {
      return NextResponse.json({
        configured: true,
        cache,
        niches: HOT_LEADGEN_NICHES,
        followedIds: followed.followedIds,
        usage,
        refreshed: false,
      });
    }

    const swipe = await swipeFollowedNiches(followed.followedIds);
    const rankedForBriefs = swipe.winners.map((w) => ({
      query: w.query,
      ad: w.ad,
      score: w.score,
      angle: w.angle,
    }));
    const briefs = briefsFromRanked(rankedForBriefs, 5);
    const next = {
      updatedAt: new Date().toISOString(),
      remainingCredits: usage?.remainingCredits ?? null,
      queries: swipe.queries,
      followedNicheIds: followed.followedIds,
      winners: swipe.winners.map((w) => ({
        query: w.query,
        score: w.score,
        angle: w.angle,
        nicheId: w.nicheId,
        nicheLabel: w.nicheLabel,
        ad: w.ad,
      })),
      discoveredBrands: swipe.discoveredBrands,
      briefs,
    };
    writeForeplaySwipe(next);

    return NextResponse.json({
      configured: true,
      cache: next,
      niches: HOT_LEADGEN_NICHES,
      followedIds: followed.followedIds,
      usage,
      refreshed: true,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Foreplay fout" },
      { status: 500 }
    );
  }
}

type PostBody =
  | { action: "briefs" | "enqueue_library"; adIds?: string[]; region?: TofRegion; count?: number }
  | { action: "follow_toggle"; nicheId: string }
  | { action: "follow_set"; nicheIds: string[] };

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const body = (await req.json()) as PostBody;

    if (body.action === "follow_toggle") {
      const followed = toggleFollowedNiche(body.nicheId);
      return NextResponse.json({
        followedIds: followed.followedIds,
        niches: HOT_LEADGEN_NICHES,
      });
    }

    if (body.action === "follow_set") {
      const followed = setFollowedNiches(body.nicheIds || []);
      return NextResponse.json({
        followedIds: followed.followedIds,
        niches: HOT_LEADGEN_NICHES,
      });
    }

    const cache = readForeplaySwipe();
    const count = Math.min(
      Math.max(("count" in body ? body.count : undefined) ?? 5, 1),
      8
    );

    const adIds = "adIds" in body ? body.adIds : undefined;
    const selected =
      adIds && adIds.length > 0
        ? cache.winners.filter((w) => adIds.includes(w.ad.id))
        : cache.winners.slice(0, count);

    if (selected.length === 0) {
      return NextResponse.json(
        { error: "Geen winners — eerst niches swipen (refresh)" },
        { status: 400 }
      );
    }

    const region = "region" in body ? body.region : undefined;
    const briefs: TofBrief[] = selected.slice(0, count).map((w, i) =>
      rempromptAd({
        ad: w.ad,
        sourceQuery: w.query,
        index: i,
        region,
      })
    );

    writeForeplaySwipe({ ...cache, briefs });

    if (body.action === "briefs") {
      return NextResponse.json({ briefs, lander: DEFAULT_LANDER });
    }

    const items: CreativeLibraryItem[] = briefs.map((b) => ({
      id: b.id,
      adName: b.adName,
      status: "draft",
      tier: "new",
      publishable: false,
      platform: b.platform,
      format: b.format,
      channel: "social",
      sourceWinnerAdId: b.sourceAdId,
      sourceWinnerAdName: `${b.sourceBrand} · ${b.angle}`,
      campaignHint: b.campaignHint,
      primaryText: b.primaryText,
      headline: b.headline,
      description: b.description,
      cta: b.cta,
      linkUrl: DEFAULT_LANDER,
      imageUrl: b.sourceImageUrl || "/creatives/winners/AD11-meta-1x1.jpg",
      thumbnailUrl: b.sourceImageUrl,
      higgsfieldJobId: null,
      createdAt: new Date().toISOString(),
      cardboardText: b.cardboardText,
      notes: `TOF via niche-swipe · query="${b.sourceQuery}" · ${b.sourceRunningDays}d · cardboard: ${b.cardboardText.replace(/\n/g, " / ")}`,
    }));

    const library = upsertCreativeItems(items);
    return NextResponse.json({ briefs, library, lander: DEFAULT_LANDER });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Foreplay POST fout" },
      { status: 500 }
    );
  }
}

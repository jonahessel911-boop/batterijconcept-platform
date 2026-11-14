import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeRol } from "@/lib/rollen";
import {
  foreplayConfigured,
  getAdsByBrandIds,
  searchBrands,
  type ForeplayAd,
} from "@/lib/foreplay";
import {
  SUGGESTED_LEADGEN_BRANDS,
  brandFromForeplay,
  readTrackedBrands,
  trackBrands,
  untrackBrands,
  writeTrackedBrands,
  type TrackedForeplayBrand,
} from "@/lib/foreplay-brands-store";
import {
  briefsFromRanked,
  rankSwipeAds,
} from "@/lib/tof-creative";
import { writeForeplaySwipe, readForeplaySwipe } from "@/lib/foreplay-swipe-store";

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

/** GET — tracked brands + suggestions + laatste pull. */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;
    const store = readTrackedBrands();
    return NextResponse.json({
      configured: foreplayConfigured(),
      store,
      suggestions: SUGGESTED_LEADGEN_BRANDS,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Brands GET fout" },
      { status: 500 }
    );
  }
}

type PostBody =
  | { action: "search"; query: string; minAds?: number }
  | { action: "track"; brands: TrackedForeplayBrand[] }
  | { action: "track_search"; query: string; nicheHint?: string }
  | { action: "untrack"; ids: string[] }
  | {
      action: "pull";
      brandIds?: string[];
      minDays?: number;
      limitPerBrand?: number;
      /** Schrijf longest-running ads ook naar Foreplay swipe winners */
      intoSwipe?: boolean;
    }
  | { action: "seed_suggestions"; limit?: number };

/**
 * POST
 * - search: zoek merken op naam
 * - track / track_search / untrack
 * - pull: longest-running ads van tracked brands
 * - seed_suggestions: resolve suggestielijst → track top hits
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;
    if (!foreplayConfigured()) {
      return NextResponse.json(
        { error: "FOREPLAY_API_KEY ontbreekt" },
        { status: 400 }
      );
    }

    const body = (await req.json()) as PostBody;

    if (body.action === "search") {
      const q = (body.query || "").trim();
      if (q.length < 2) {
        return NextResponse.json({ error: "Query te kort" }, { status: 400 });
      }
      const brands = await searchBrands({
        query: q,
        limit: 25,
        minAds: body.minAds ?? 5,
      });
      const tracked = new Set(readTrackedBrands().brands.map((b) => b.id));
      return NextResponse.json({
        brands: brands.map((b) => ({
          ...b,
          tracked: tracked.has(b.id),
        })),
      });
    }

    if (body.action === "track") {
      if (!Array.isArray(body.brands) || body.brands.length === 0) {
        return NextResponse.json({ error: "Geen brands" }, { status: 400 });
      }
      const store = trackBrands(body.brands);
      return NextResponse.json({ store });
    }

    if (body.action === "track_search") {
      const q = (body.query || "").trim();
      if (q.length < 2) {
        return NextResponse.json({ error: "Query te kort" }, { status: 400 });
      }
      const found = await searchBrands({ query: q, limit: 5, minAds: 3 });
      if (!found.length) {
        return NextResponse.json(
          { error: `Geen brand gevonden voor “${q}”` },
          { status: 404 }
        );
      }
      // Prefer highest ads_count
      const best = [...found].sort(
        (a, b) => (b.ads_count || 0) - (a.ads_count || 0)
      )[0]!;
      const store = trackBrands([
        brandFromForeplay(best, body.nicheHint ?? null),
      ]);
      return NextResponse.json({ store, added: best });
    }

    if (body.action === "untrack") {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const store = untrackBrands(ids);
      return NextResponse.json({ store });
    }

    if (body.action === "seed_suggestions") {
      const limit = Math.min(body.limit ?? 20, SUGGESTED_LEADGEN_BRANDS.length);
      const added: TrackedForeplayBrand[] = [];
      const errors: string[] = [];
      for (const s of SUGGESTED_LEADGEN_BRANDS.slice(0, limit)) {
        try {
          const found = await searchBrands({
            query: s.query,
            limit: 3,
            minAds: 5,
          });
          if (!found.length) {
            errors.push(`${s.query}: niets`);
            continue;
          }
          const best = [...found].sort(
            (a, b) => (b.ads_count || 0) - (a.ads_count || 0)
          )[0]!;
          added.push(brandFromForeplay(best, s.nicheHint));
        } catch (e) {
          errors.push(
            `${s.query}: ${e instanceof Error ? e.message : "fout"}`
          );
        }
      }
      const store = trackBrands(added);
      return NextResponse.json({
        store,
        addedCount: added.length,
        errors,
      });
    }

    if (body.action === "pull") {
      const store = readTrackedBrands();
      const ids =
        body.brandIds && body.brandIds.length > 0
          ? body.brandIds
          : store.brands.map((b) => b.id);
      if (ids.length === 0) {
        return NextResponse.json(
          { error: "Geen tracked brands — eerst merken toevoegen" },
          { status: 400 }
        );
      }

      const minDays = body.minDays ?? 21;
      const limitPerBrand = Math.min(body.limitPerBrand ?? 8, 25);
      const byId = new Map(store.brands.map((b) => [b.id, b]));
      const collected: { brandId: string; brandName: string; ad: ForeplayAd }[] =
        [];

      // Parallel in small batches to avoid rate limits
      const chunkSize = 4;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (brandId) => {
            const brand = byId.get(brandId);
            try {
              const res = await getAdsByBrandIds({
                brandIds: [brandId],
                displayFormat: "image",
                order: "longest_running",
                runningDurationMinDays: minDays,
                limit: limitPerBrand,
              });
              for (const ad of res.ads) {
                collected.push({
                  brandId,
                  brandName: brand?.name || ad.name || brandId,
                  ad,
                });
              }
            } catch {
              /* soft fail per brand */
            }
          })
        );
      }

      const nextStore = {
        ...store,
        lastPullAt: new Date().toISOString(),
        lastPullAds: collected,
      };
      writeTrackedBrands(nextStore);

      let swipe = readForeplaySwipe();
      if (body.intoSwipe !== false) {
        const ranked = rankSwipeAds(
          collected.map((c) => ({
            query: `brand:${c.brandName}`,
            ad: c.ad,
          }))
        );
        const briefs = briefsFromRanked(ranked, 5);
        swipe = {
          ...swipe,
          updatedAt: new Date().toISOString(),
          queries: [
            ...new Set([
              ...swipe.queries,
              ...collected.map((c) => `brand:${c.brandName}`),
            ]),
          ],
          winners: ranked.slice(0, 40).map((r) => ({
            query: r.query,
            score: r.score,
            angle: r.angle,
            ad: r.ad,
          })),
          briefs,
        };
        writeForeplaySwipe(swipe);
      }

      return NextResponse.json({
        store: nextStore,
        pulled: collected.length,
        brandsPulled: ids.length,
        swipe,
      });
    }

    return NextResponse.json({ error: "Onbekende action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Brands POST fout" },
      { status: 500 }
    );
  }
}

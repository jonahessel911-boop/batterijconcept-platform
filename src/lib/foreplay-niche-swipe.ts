/**
 * Swipe Foreplay ads for followed hot lead-gen niches with strict scoring.
 */

import { discoverAds, runningDays, type ForeplayAd } from "@/lib/foreplay";
import {
  HOT_LEADGEN_NICHES,
  nicheById,
  scoreLeadgenAd,
  type HotLeadgenNiche,
} from "@/lib/hot-leadgen-niches";
import { detectAngle, type TofAngle } from "@/lib/tof-creative";

export type NicheWinner = {
  nicheId: string;
  nicheLabel: string;
  query: string;
  score: number;
  angle: TofAngle;
  ad: ForeplayAd;
};

export async function swipeFollowedNiches(
  followedIds: string[]
): Promise<{
  queries: string[];
  winners: NicheWinner[];
  discoveredBrands: { name: string; nicheId: string; count: number }[];
}> {
  const niches = followedIds
    .map((id) => nicheById(id))
    .filter((n): n is HotLeadgenNiche => Boolean(n));

  const active = niches.length > 0 ? niches : HOT_LEADGEN_NICHES.slice(0, 5);

  const collected: {
    niche: HotLeadgenNiche;
    query: string;
    ad: ForeplayAd;
  }[] = [];

  const jobs: { niche: HotLeadgenNiche; query: string }[] = [];
  for (const niche of active) {
    for (const query of niche.queries) {
      jobs.push({ niche, query });
    }
  }

  // Parallel in batches of 6
  const batchSize = 6;
  for (let i = 0; i < jobs.length; i += batchSize) {
    const batch = jobs.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async ({ niche, query }) => {
        try {
          const res = await discoverAds({
            query,
            live: true,
            displayFormat: "image",
            order: "longest_running",
            runningDurationMinDays: 30,
            limit: 10,
            languages: "english",
          });
          for (const ad of res.ads) {
            collected.push({ niche, query, ad });
          }
        } catch {
          /* soft */
        }
      })
    );
  }

  const seen = new Set<string>();
  const scored: NicheWinner[] = [];
  const brandCounts = new Map<string, { name: string; nicheId: string; count: number }>();

  for (const row of collected) {
    if (!row.ad?.id || seen.has(row.ad.id)) continue;
    if (!row.ad.image && !row.ad.thumbnail) continue;
    seen.add(row.ad.id);

    const score = scoreLeadgenAd({
      niche: row.niche,
      headline: row.ad.headline,
      description: row.ad.description,
      brandName: row.ad.name,
      runningDays: runningDays(row.ad),
    });
    if (score == null) continue;

    scored.push({
      nicheId: row.niche.id,
      nicheLabel: row.niche.label,
      query: row.query,
      score,
      angle: detectAngle(row.ad),
      ad: row.ad,
    });

    const brandName = (row.ad.name || "").trim();
    if (brandName) {
      const key = `${row.niche.id}::${brandName.toLowerCase()}`;
      const cur = brandCounts.get(key);
      if (cur) cur.count += 1;
      else brandCounts.set(key, { name: brandName, nicheId: row.niche.id, count: 1 });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return {
    queries: jobs.map((j) => j.query),
    winners: scored.slice(0, 60),
    discoveredBrands: [...brandCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 40),
  };
}

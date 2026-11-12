/**
 * Cache laatste Foreplay swipe + TOF briefs (JSON op disk).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { ForeplayAd } from "@/lib/foreplay";
import type { TofBrief } from "@/lib/tof-creative";

const PATH = join(process.cwd(), "data", "foreplay-swipe.json");

export type ForeplaySwipeCache = {
  updatedAt: string;
  remainingCredits: number | null;
  queries: string[];
  followedNicheIds?: string[];
  winners: {
    query: string;
    score: number;
    angle: string;
    nicheId?: string;
    nicheLabel?: string;
    ad: ForeplayAd;
  }[];
  /** Brands die in winners opduiken — kandidaat om te tracken */
  discoveredBrands?: { name: string; nicheId: string; count: number }[];
  briefs: TofBrief[];
};

function empty(): ForeplaySwipeCache {
  return {
    updatedAt: new Date().toISOString(),
    remainingCredits: null,
    queries: [],
    followedNicheIds: [],
    winners: [],
    discoveredBrands: [],
    briefs: [],
  };
}

export function readForeplaySwipe(): ForeplaySwipeCache {
  try {
    if (!existsSync(PATH)) return empty();
    const parsed = JSON.parse(readFileSync(PATH, "utf8")) as ForeplaySwipeCache;
    if (!parsed || !Array.isArray(parsed.winners)) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

export function writeForeplaySwipe(cache: ForeplaySwipeCache): void {
  mkdirSync(dirname(PATH), { recursive: true });
  writeFileSync(
    PATH,
    JSON.stringify({ ...cache, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

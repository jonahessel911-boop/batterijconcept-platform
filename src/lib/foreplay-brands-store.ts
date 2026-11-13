/**
 * Intern tracked Foreplay brands (lead-gen / white-label merken).
 * Spyder-account is leeg — we tracken zelf in CRM en pullen via getAdsByBrandId.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { ForeplayAd, ForeplayBrand } from "@/lib/foreplay";

const PATH = join(process.cwd(), "data", "foreplay-tracked-brands.json");

export type TrackedForeplayBrand = {
  id: string;
  name: string;
  category: string | null;
  avatar: string | null;
  adsCount: number | null;
  activeAdsCount: number | null;
  url: string | null;
  websites: string[] | null;
  adLibraryId: string | null;
  /** Eigen label: solar / bath / insurance / windows / … */
  nicheHint: string | null;
  notes: string | null;
  trackedAt: string;
};

export type ForeplayBrandsStore = {
  updatedAt: string;
  brands: TrackedForeplayBrand[];
  /** Laatste pull van ads per brand */
  lastPullAt: string | null;
  lastPullAds: {
    brandId: string;
    brandName: string;
    ad: ForeplayAd;
  }[];
};

/** Startlijst — zoeknamen om 1-klik te resolven naar Foreplay brand IDs. */
export const SUGGESTED_LEADGEN_BRANDS: {
  query: string;
  nicheHint: string;
}[] = [
  { query: "Leaf Home Bath", nicheHint: "bath" },
  { query: "Leaf Filter", nicheHint: "home" },
  { query: "HomeBuddy.com", nicheHint: "home" },
  { query: "Bath Planet", nicheHint: "bath" },
  { query: "ReBath", nicheHint: "bath" },
  { query: "West Shore Home", nicheHint: "bath" },
  { query: "SelectQuote", nicheHint: "insurance" },
  { query: "Policygenius", nicheHint: "insurance" },
  { query: "Ethos Life", nicheHint: "insurance" },
  { query: "Ladder Life", nicheHint: "insurance" },
  { query: "Momentum Solar", nicheHint: "solar" },
  { query: "Palmetto Solar", nicheHint: "solar" },
  { query: "Sunrun", nicheHint: "solar" },
  { query: "Power Home Remodeling", nicheHint: "windows" },
  { query: "Renewal by Andersen", nicheHint: "windows" },
  { query: "Window Nation", nicheHint: "windows" },
  { query: "Medical Guardian", nicheHint: "senior" },
  { query: "Bay Alarm Medical", nicheHint: "senior" },
  { query: "Life Alert", nicheHint: "senior" },
  { query: "The Home Depot", nicheHint: "home" },
];

function empty(): ForeplayBrandsStore {
  return {
    updatedAt: new Date().toISOString(),
    brands: [],
    lastPullAt: null,
    lastPullAds: [],
  };
}

export function readTrackedBrands(): ForeplayBrandsStore {
  try {
    if (!existsSync(PATH)) return empty();
    const parsed = JSON.parse(readFileSync(PATH, "utf8")) as ForeplayBrandsStore;
    if (!parsed || !Array.isArray(parsed.brands)) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

export function writeTrackedBrands(store: ForeplayBrandsStore): void {
  mkdirSync(dirname(PATH), { recursive: true });
  writeFileSync(
    PATH,
    JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

export function brandFromForeplay(
  b: ForeplayBrand,
  nicheHint?: string | null
): TrackedForeplayBrand {
  return {
    id: b.id,
    name: b.name,
    category: b.category,
    avatar: b.avatar,
    adsCount: b.ads_count,
    activeAdsCount: b.active_ads_count,
    url: b.url,
    websites: b.websites,
    adLibraryId: b.ad_library_id,
    nicheHint: nicheHint ?? null,
    notes: null,
    trackedAt: new Date().toISOString(),
  };
}

export function trackBrands(
  brands: TrackedForeplayBrand[]
): ForeplayBrandsStore {
  const store = readTrackedBrands();
  const byId = new Map(store.brands.map((b) => [b.id, b]));
  for (const b of brands) byId.set(b.id, { ...byId.get(b.id), ...b });
  const next = {
    ...store,
    updatedAt: new Date().toISOString(),
    brands: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
  writeTrackedBrands(next);
  return next;
}

export function untrackBrands(ids: string[]): ForeplayBrandsStore {
  const store = readTrackedBrands();
  const drop = new Set(ids);
  const next = {
    ...store,
    updatedAt: new Date().toISOString(),
    brands: store.brands.filter((b) => !drop.has(b.id)),
    lastPullAds: store.lastPullAds.filter((a) => !drop.has(a.brandId)),
  };
  writeTrackedBrands(next);
  return next;
}

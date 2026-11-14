/**
 * Foreplay Public API — ad discovery / swipefile.
 * Docs: https://docs.foreplay.co · OpenAPI: https://public.api.foreplay.co/openapi.json
 */

const FOREPLAY_BASE = "https://public.api.foreplay.co";

export type ForeplayRunningDuration = {
  seconds?: number;
  minutes?: number;
  hours?: number;
  days?: number;
};

export type ForeplayAd = {
  id: string;
  ad_id?: string;
  name: string | null;
  headline: string | null;
  description: string | null;
  cta_type: string | null;
  cta_title?: string | null;
  link_url: string | null;
  image: string | null;
  thumbnail: string | null;
  avatar?: string | null;
  video?: string | null;
  live: boolean | null;
  display_format: string | null;
  niches: string[] | null;
  languages?: string[] | null;
  publisher_platform?: string[] | null;
  running_duration: ForeplayRunningDuration | null;
  started_running?: number | null;
  foreplay_url?: string | null;
  brand_id?: string | null;
  market_target?: string | null;
};

export type ForeplayDiscoveryResult = {
  ads: ForeplayAd[];
  cursor: string | null;
  count: number;
  remainingCredits: number | null;
};

export function foreplayConfigured(): boolean {
  return Boolean(process.env.FOREPLAY_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.FOREPLAY_API_KEY?.trim();
  if (!key) throw new Error("FOREPLAY_API_KEY ontbreekt");
  return key;
}

async function foreplayGet<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined | null>
): Promise<T> {
  const url = new URL(path, FOREPLAY_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const json = (await res.json()) as {
    metadata?: { success?: boolean; message?: string; status_code?: number };
    data?: T;
    error?: { message?: string } | null;
  };
  if (!res.ok || json.metadata?.success === false) {
    throw new Error(
      json.error?.message ||
        json.metadata?.message ||
        `Foreplay HTTP ${res.status}`
    );
  }
  return json.data as T;
}

export async function foreplayUsage(): Promise<{
  totalCredits: number;
  remainingCredits: number;
  email: string | null;
}> {
  const data = await foreplayGet<{
    total_credits?: number;
    remaining_credits?: number;
    user?: { email?: string };
  }>("/api/usage");
  return {
    totalCredits: data.total_credits ?? 0,
    remainingCredits: data.remaining_credits ?? 0,
    email: data.user?.email ?? null,
  };
}

export type ForeplayDiscoveryParams = {
  query?: string;
  live?: boolean;
  displayFormat?: string;
  order?: "newest" | "oldest" | "longest_running" | "most_relevant";
  runningDurationMinDays?: number;
  languages?: string;
  niches?: string;
  publisherPlatform?: string;
  limit?: number;
  cursor?: string;
};

/**
 * Discovery ads — default: live image ads, longest running first.
 */
export async function discoverAds(
  params: ForeplayDiscoveryParams = {}
): Promise<ForeplayDiscoveryResult> {
  const url = new URL("/api/discovery/ads", FOREPLAY_BASE);
  const q: Record<string, string> = {};
  if (params.query) q.query = params.query;
  if (params.live !== undefined) q.live = String(params.live);
  if (params.displayFormat) q.display_format = params.displayFormat;
  if (params.order) q.order = params.order;
  if (params.runningDurationMinDays != null) {
    q.running_duration_min_days = String(params.runningDurationMinDays);
  }
  if (params.languages) q.languages = params.languages;
  if (params.niches) q.niches = params.niches;
  if (params.publisherPlatform) q.publisher_platform = params.publisherPlatform;
  if (params.limit != null) q.limit = String(params.limit);
  if (params.cursor) q.cursor = params.cursor;

  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const json = (await res.json()) as {
    metadata?: {
      success?: boolean;
      message?: string;
      cursor?: string | null;
      count?: number;
    };
    data?: ForeplayAd[];
    error?: { message?: string } | null;
  };
  if (!res.ok || json.metadata?.success === false) {
    throw new Error(
      json.error?.message ||
        json.metadata?.message ||
        `Foreplay HTTP ${res.status}`
    );
  }
  return {
    ads: Array.isArray(json.data) ? json.data : [],
    cursor: json.metadata?.cursor ?? null,
    count: json.metadata?.count ?? (json.data?.length ?? 0),
    remainingCredits: null,
  };
}

export function runningDays(ad: ForeplayAd): number {
  return ad.running_duration?.days ?? 0;
}

export type ForeplayBrand = {
  id: string;
  name: string;
  description?: { text?: string } | string | null;
  category: string | null;
  niches: string[] | null;
  url: string | null;
  websites: string[] | null;
  avatar: string | null;
  ad_library_id: string | null;
  ads_count: number | null;
  active_ads_count: number | null;
  verification_status?: string | null;
};

export async function searchBrands(opts: {
  query: string;
  limit?: number;
  minAds?: number;
}): Promise<ForeplayBrand[]> {
  const data = await foreplayGet<ForeplayBrand[]>("/api/discovery/brands", {
    query: opts.query,
    limit: opts.limit ?? 20,
    min_ads: opts.minAds ?? 5,
    include_empty: false,
  });
  return Array.isArray(data) ? data : [];
}

export async function getAdsByBrandIds(opts: {
  brandIds: string[];
  live?: boolean;
  displayFormat?: string;
  order?: "newest" | "oldest" | "longest_running" | "most_relevant";
  runningDurationMinDays?: number;
  limit?: number;
}): Promise<ForeplayDiscoveryResult> {
  if (!opts.brandIds.length) {
    return { ads: [], cursor: null, count: 0, remainingCredits: null };
  }
  const url = new URL("/api/brand/getAdsByBrandId", FOREPLAY_BASE);
  url.searchParams.set("brand_ids", opts.brandIds.join(","));
  if (opts.live !== undefined) url.searchParams.set("live", String(opts.live));
  if (opts.displayFormat) url.searchParams.set("display_format", opts.displayFormat);
  if (opts.order) url.searchParams.set("order", opts.order);
  if (opts.runningDurationMinDays != null) {
    url.searchParams.set(
      "running_duration_min_days",
      String(opts.runningDurationMinDays)
    );
  }
  if (opts.limit != null) url.searchParams.set("limit", String(opts.limit));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const json = (await res.json()) as {
    metadata?: {
      success?: boolean;
      message?: string;
      cursor?: string | null;
      count?: number;
    };
    data?: ForeplayAd[];
    error?: { message?: string } | null;
  };
  if (!res.ok || json.metadata?.success === false) {
    throw new Error(
      json.error?.message ||
        json.metadata?.message ||
        `Foreplay HTTP ${res.status}`
    );
  }
  return {
    ads: Array.isArray(json.data) ? json.data : [],
    cursor: json.metadata?.cursor ?? null,
    count: json.metadata?.count ?? (json.data?.length ?? 0),
    remainingCredits: null,
  };
}

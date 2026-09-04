import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { getSupabaseAdmin } from "@/lib/supabase";

const GRAPH_VERSION = "v21.0";
const TZ = "Europe/Amsterdam";
const META_BRON_NOTE = "meta_ads_sync";

export type MetaAdSpendDay = {
  date: string;
  spend: number;
  impressions?: number;
  clicks?: number;
  campaign_name?: string | null;
  ad_name?: string | null;
};

export type MetaAdSpendFetchResult = {
  ok: boolean;
  configured: boolean;
  accountId: string | null;
  since: string;
  until: string;
  days: MetaAdSpendDay[];
  totalSpend: number;
  error?: string;
};

export type MetaAdSpendSyncResult = MetaAdSpendFetchResult & {
  upserted: number;
  skipped?: boolean;
  reason?: string;
};

function adsAccessToken(): string | null {
  return (
    process.env.META_ADS_ACCESS_TOKEN?.trim() ||
    process.env.META_CAPI_ACCESS_TOKEN?.trim() ||
    null
  );
}

function adAccountId(): string | null {
  const raw = process.env.META_AD_ACCOUNT_ID?.trim();
  if (!raw) return null;
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

export function metaAdsSpendConfigured(): {
  ok: boolean;
  missing: string[];
  accountId: string | null;
} {
  const missing: string[] = [];
  const accountId = adAccountId();
  const token = adsAccessToken();
  if (!accountId) missing.push("META_AD_ACCOUNT_ID");
  if (!token) missing.push("META_ADS_ACCESS_TOKEN (of META_CAPI_ACCESS_TOKEN)");
  return { ok: missing.length === 0, missing, accountId };
}

function ymdInAmsterdam(d: Date): string {
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}

/** Default: laatste 30 dagen t/m gisteren (Amsterdam). */
export function defaultSpendRange(daysBack = 30): {
  since: string;
  until: string;
} {
  const untilDate = subDays(new Date(), 1);
  const sinceDate = subDays(untilDate, daysBack - 1);
  return {
    since: ymdInAmsterdam(sinceDate),
    until: ymdInAmsterdam(untilDate),
  };
}

type GraphInsightRow = {
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  campaign_name?: string;
  ad_name?: string;
};

type GraphInsightsResponse = {
  data?: GraphInsightRow[];
  paging?: { next?: string };
  error?: { message?: string; code?: number; type?: string };
};

async function graphGet(url: string): Promise<GraphInsightsResponse> {
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  const json = (await res.json()) as GraphInsightsResponse;
  if (!res.ok || json.error) {
    throw new Error(
      json.error?.message || `Meta Graph HTTP ${res.status}`
    );
  }
  return json;
}

/**
 * Haalt dagelijkse account-spend op via Insights API.
 * level: account (default) | campaign | ad — campaign/ad voor breakdown-preview.
 */
export async function fetchMetaAdSpend(options?: {
  since?: string;
  until?: string;
  level?: "account" | "campaign" | "ad";
  timeIncrement?: "1" | "7" | "monthly";
}): Promise<MetaAdSpendFetchResult> {
  const cfg = metaAdsSpendConfigured();
  const range = {
    since: options?.since || defaultSpendRange().since,
    until: options?.until || defaultSpendRange().until,
  };

  if (!cfg.ok || !cfg.accountId) {
    return {
      ok: false,
      configured: false,
      accountId: cfg.accountId,
      since: range.since,
      until: range.until,
      days: [],
      totalSpend: 0,
      error: `Ontbrekende env: ${cfg.missing.join(", ")}`,
    };
  }

  const token = adsAccessToken()!;
  const level = options?.level || "account";
  const timeIncrement = options?.timeIncrement || "1";
  const fields =
    level === "ad"
      ? "spend,impressions,clicks,campaign_name,ad_name"
      : level === "campaign"
        ? "spend,impressions,clicks,campaign_name"
        : "spend,impressions,clicks";

  const params = new URLSearchParams({
    fields,
    level,
    time_increment: timeIncrement,
    time_range: JSON.stringify({ since: range.since, until: range.until }),
    limit: "500",
    access_token: token,
  });

  let nextUrl: string | null =
    `https://graph.facebook.com/${GRAPH_VERSION}/${cfg.accountId}/insights?${params}`;

  const days: MetaAdSpendDay[] = [];

  try {
    while (nextUrl) {
      const page = await graphGet(nextUrl);
      for (const row of page.data || []) {
        const date = row.date_start || row.date_stop;
        if (!date) continue;
        const spend = Number(row.spend || 0);
        if (!Number.isFinite(spend)) continue;
        days.push({
          date,
          spend: Math.round(spend * 100) / 100,
          impressions: row.impressions ? Number(row.impressions) : undefined,
          clicks: row.clicks ? Number(row.clicks) : undefined,
          campaign_name: row.campaign_name || null,
          ad_name: row.ad_name || null,
        });
      }
      nextUrl = page.paging?.next || null;
    }

    const totalSpend =
      Math.round(days.reduce((s, d) => s + d.spend, 0) * 100) / 100;

    return {
      ok: true,
      configured: true,
      accountId: cfg.accountId,
      since: range.since,
      until: range.until,
      days,
      totalSpend,
    };
  } catch (e) {
    return {
      ok: false,
      configured: true,
      accountId: cfg.accountId,
      since: range.since,
      until: range.until,
      days: [],
      totalSpend: 0,
      error: e instanceof Error ? e.message : "Meta Ads fetch mislukt",
    };
  }
}

/** Aggregeer rijen per kalenderdag (voor campaign/ad-level → 1 bedrag/dag). */
function aggregateByDate(days: MetaAdSpendDay[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of days) {
    map.set(d.date, Math.round(((map.get(d.date) || 0) + d.spend) * 100) / 100);
  }
  return map;
}

/**
 * Haalt account-spend op en schrijft naar rapportage_kosten (soort=ad_spend).
 * Bedrijfsspend: adviseur_id = null. Overscrijft bestaande Meta-sync rijen per dag.
 */
export async function syncMetaAdSpend(options?: {
  since?: string;
  until?: string;
  dryRun?: boolean;
  timeIncrement?: "1" | "7" | "monthly";
}): Promise<MetaAdSpendSyncResult> {
  const fetched = await fetchMetaAdSpend({
    since: options?.since,
    until: options?.until,
    level: "account",
    timeIncrement: options?.timeIncrement || "1",
  });

  if (!fetched.ok) {
    return {
      ...fetched,
      upserted: 0,
      skipped: true,
      reason: fetched.error,
    };
  }

  const byDate = aggregateByDate(fetched.days);

  if (options?.dryRun) {
    return {
      ...fetched,
      upserted: byDate.size,
      skipped: true,
      reason: "dry_run",
    };
  }

  const sb = getSupabaseAdmin();
  let upserted = 0;

  for (const [datum, bedrag] of byDate) {
    const { data: existing, error: selErr } = await sb
      .from("rapportage_kosten")
      .select("id")
      .eq("datum", datum)
      .eq("soort", "ad_spend")
      .is("adviseur_id", null)
      .limit(1)
      .maybeSingle();

    if (selErr) {
      return {
        ...fetched,
        upserted,
        ok: false,
        error: selErr.message,
      };
    }

    if (existing?.id) {
      const { error } = await sb
        .from("rapportage_kosten")
        .update({
          bedrag,
          notities: META_BRON_NOTE,
        })
        .eq("id", existing.id);
      if (error) {
        return { ...fetched, upserted, ok: false, error: error.message };
      }
    } else {
      const { error } = await sb.from("rapportage_kosten").insert({
        datum,
        soort: "ad_spend",
        bedrag,
        adviseur_id: null,
        notities: META_BRON_NOTE,
      });
      if (error) {
        return { ...fetched, upserted, ok: false, error: error.message };
      }
    }
    upserted += 1;
  }

  // Best-effort: ook campaign-detail + sync-timestamp
  await syncMetaAdSpendCampaignDetail({
    since: options?.since || fetched.since,
    until: options?.until || fetched.until,
  }).catch(() => null);
  await touchDashboardMetaSync(fetched.until);

  return { ...fetched, upserted };
}

/** Schrijf campaign-level spend naar meta_ad_spend (aparte tabel, geen dubbeltelling in totals). */
export async function syncMetaAdSpendCampaignDetail(options?: {
  since?: string;
  until?: string;
}): Promise<{ upserted: number; error?: string }> {
  const fetched = await fetchMetaAdSpend({
    since: options?.since,
    until: options?.until,
    level: "campaign",
    timeIncrement: "1",
  });
  if (!fetched.ok) return { upserted: 0, error: fetched.error };

  const sb = getSupabaseAdmin();
  let upserted = 0;
  for (const day of fetched.days) {
    const campaignId = day.campaign_name || "unknown";
    const { data: existing } = await sb
      .from("meta_ad_spend")
      .select("id")
      .eq("datum", day.date)
      .eq("level", "campaign")
      .eq("campaign_id", campaignId)
      .eq("adset_id", "")
      .eq("ad_id", "")
      .maybeSingle();

    const row = {
      datum: day.date,
      level: "campaign" as const,
      campaign_id: campaignId,
      campaign_name: day.campaign_name || null,
      adset_id: "",
      ad_id: "",
      spend: day.spend,
      impressions: day.impressions ?? null,
      clicks: day.clicks ?? null,
      synced_at: new Date().toISOString(),
    };

    const { error } = existing?.id
      ? await sb.from("meta_ad_spend").update(row).eq("id", existing.id)
      : await sb.from("meta_ad_spend").insert(row);

    if (error) {
      return { upserted, error: error.message };
    }
    upserted += 1;
  }
  return { upserted };
}

async function touchDashboardMetaSync(until: string) {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from("dashboard_instellingen")
      .select("id")
      .eq("actief", true)
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      await sb
        .from("dashboard_instellingen")
        .update({
          meta_laatste_sync_at: new Date().toISOString(),
          meta_laatste_sync_until: until,
        })
        .eq("id", data.id);
    }
  } catch {
    /* optioneel */
  }
}

export type MetaAdSpendBackfillResult = {
  ok: boolean;
  configured: boolean;
  accountId: string | null;
  since: string;
  until: string;
  chunks: number;
  callsEstimate: number;
  upserted: number;
  totalSpend: number;
  errors: string[];
};

function parseYmdAsUtc(v: string): Date {
  return new Date(`${v}T00:00:00.000Z`);
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Backfill met beperkte call-druk:
 * - chunked ranges (default 90 dagen)
 * - timeIncrement=7 (week-buckets) om volume laag te houden
 */
export async function syncMetaAdSpendBackfill(options: {
  since: string;
  until: string;
  chunkDays?: number;
  timeIncrement?: "1" | "7" | "monthly";
  maxChunks?: number;
  dryRun?: boolean;
}): Promise<MetaAdSpendBackfillResult> {
  const cfg = metaAdsSpendConfigured();
  if (!cfg.ok || !cfg.accountId) {
    return {
      ok: false,
      configured: false,
      accountId: cfg.accountId,
      since: options.since,
      until: options.until,
      chunks: 0,
      callsEstimate: 0,
      upserted: 0,
      totalSpend: 0,
      errors: [`Ontbrekende env: ${cfg.missing.join(", ")}`],
    };
  }

  const chunkDays = Math.max(14, options.chunkDays || 90);
  const maxChunks = Math.max(1, options.maxChunks || 30);
  const timeIncrement = options.timeIncrement || "7";
  let cursor = parseYmdAsUtc(options.since);
  const end = parseYmdAsUtc(options.until);

  let chunks = 0;
  let upserted = 0;
  let totalSpend = 0;
  const errors: string[] = [];

  while (cursor <= end && chunks < maxChunks) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + (chunkDays - 1));
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    const result = await syncMetaAdSpend({
      since: ymdUtc(chunkStart),
      until: ymdUtc(chunkEnd),
      dryRun: options.dryRun,
      timeIncrement,
    });

    chunks += 1;
    upserted += result.upserted || 0;
    totalSpend = Math.round((totalSpend + (result.totalSpend || 0)) * 100) / 100;
    if (!result.ok && result.error) {
      errors.push(`[${result.since}..${result.until}] ${result.error}`);
    }

    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  if (cursor <= end) {
    errors.push(
      `Backfill gestopt op maxChunks=${maxChunks} om rate-limit veilig te blijven`
    );
  }

  return {
    ok: errors.length === 0,
    configured: true,
    accountId: cfg.accountId,
    since: options.since,
    until: options.until,
    chunks,
    callsEstimate: chunks,
    upserted,
    totalSpend,
    errors,
  };
}

/**
 * Meta BANEN ad-account (recruitment) — gescheiden van leadgen AD V1.
 * Default: act_1612761207043144
 */

import { formatInTimeZone } from "date-fns-tz";
import { subDays } from "date-fns";
import {
  leadsFromMetaActions,
  type MetaAdSpendDay,
  type MetaAdSpendFetchResult,
} from "@/lib/meta-ads-spend";

const GRAPH_VERSION = "v21.0";
const TZ = "Europe/Amsterdam";

export const META_BANEN_AD_ACCOUNT_ID_DEFAULT = "act_1612761207043144";

function adsAccessToken(): string | null {
  return (
    process.env.META_ADS_ACCESS_TOKEN?.trim() ||
    process.env.META_CAPI_ACCESS_TOKEN?.trim() ||
    null
  );
}

export function metaBanenAdAccountId(): string {
  const raw =
    process.env.META_BANEN_AD_ACCOUNT_ID?.trim() ||
    META_BANEN_AD_ACCOUNT_ID_DEFAULT;
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

export function metaBanenSpendConfigured(): {
  ok: boolean;
  missing: string[];
  accountId: string;
} {
  const missing: string[] = [];
  const token = adsAccessToken();
  if (!token) missing.push("META_ADS_ACCESS_TOKEN (of META_CAPI_ACCESS_TOKEN)");
  return { ok: missing.length === 0, missing, accountId: metaBanenAdAccountId() };
}

function ymdInAmsterdam(d: Date): string {
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}

export function defaultBanenRange(daysBack = 30): {
  since: string;
  until: string;
} {
  const untilDate = new Date();
  const sinceDate = subDays(untilDate, daysBack - 1);
  return {
    since: ymdInAmsterdam(sinceDate),
    until: ymdInAmsterdam(untilDate),
  };
}

type GraphInsightAction = {
  action_type?: string;
  value?: string;
};

type GraphInsightRow = {
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  campaign_id?: string;
  campaign_name?: string;
  ad_id?: string;
  ad_name?: string;
  actions?: GraphInsightAction[];
};

async function graphGet(url: string): Promise<{
  data?: GraphInsightRow[];
  paging?: { next?: string };
  error?: { message?: string };
}> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as {
    data?: GraphInsightRow[];
    paging?: { next?: string };
    error?: { message?: string };
  };
  if (!res.ok || json.error) {
    throw new Error(
      json.error?.message || `Meta Graph HTTP ${res.status}`
    );
  }
  return json;
}

/** Heel BANEN-account: spend + lead/results per dag (campaign-level). */
export async function fetchMetaBanenSpend(options?: {
  since?: string;
  until?: string;
  level?: "account" | "campaign" | "ad";
}): Promise<MetaAdSpendFetchResult> {
  const cfg = metaBanenSpendConfigured();
  const range = {
    since: options?.since || defaultBanenRange().since,
    until: options?.until || defaultBanenRange().until,
  };

  if (!cfg.ok) {
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
  const breakdown = options?.level || "campaign";
  const fields =
    breakdown === "ad"
      ? "spend,impressions,clicks,actions,campaign_id,campaign_name,ad_id,ad_name"
      : breakdown === "campaign"
        ? "spend,impressions,clicks,actions,campaign_id,campaign_name"
        : "spend,impressions,clicks,actions";

  const params = new URLSearchParams({
    fields,
    time_increment: "1",
    time_range: JSON.stringify({ since: range.since, until: range.until }),
    limit: "500",
    access_token: token,
  });
  if (breakdown !== "account") params.set("level", breakdown);

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
        const leads = leadsFromMetaActions(row.actions);
        days.push({
          date,
          spend: Math.round(spend * 100) / 100,
          leads,
          impressions: row.impressions ? Number(row.impressions) : undefined,
          clicks: row.clicks ? Number(row.clicks) : undefined,
          campaign_id: row.campaign_id || null,
          campaign_name: row.campaign_name || null,
          ad_id: row.ad_id || null,
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
      error: e instanceof Error ? e.message : "Meta BANEN fetch mislukt",
    };
  }
}

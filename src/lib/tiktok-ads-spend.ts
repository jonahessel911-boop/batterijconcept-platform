import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { MarketingMetaRow } from "@/lib/marketing-rapportage";
import { tiktokAppId } from "@/lib/tiktok-ads";

const API = "https://business-api.tiktok.com/open_api/v1.3";
const AUTH_FILE = path.join(process.cwd(), "data", "tiktok-ads-auth.json");
const AUTH_BUCKET = "crm-private";
const AUTH_OBJECT = "tiktok-ads-auth.json";

export type TikTokAdsAuth = {
  access_token: string;
  refresh_token: string | null;
  advertiser_ids: string[];
  updated_at: string;
};

type TikTokEnvelope<T> = {
  code?: number;
  message?: string;
  data?: T;
};

function appSecret(): string | null {
  const s = process.env.TIKTOK_APP_SECRET?.trim();
  return s || null;
}

function envAuth(): TikTokAdsAuth | null {
  const access = process.env.TIKTOK_ADS_ACCESS_TOKEN?.trim();
  if (!access) return null;
  const ids = (process.env.TIKTOK_ADVERTISER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    access_token: access,
    refresh_token: process.env.TIKTOK_ADS_REFRESH_TOKEN?.trim() || null,
    advertiser_ids: ids,
    updated_at: new Date(0).toISOString(),
  };
}

async function readAuthFile(): Promise<TikTokAdsAuth | null> {
  try {
    const raw = await readFile(AUTH_FILE, "utf8");
    const parsed = JSON.parse(raw) as TikTokAdsAuth;
    if (!parsed?.access_token) return null;
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token || null,
      advertiser_ids: Array.isArray(parsed.advertiser_ids)
        ? parsed.advertiser_ids.map(String)
        : [],
      updated_at: parsed.updated_at || new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

async function writeAuthFile(auth: TikTokAdsAuth): Promise<void> {
  try {
    await mkdir(path.dirname(AUTH_FILE), { recursive: true });
    await writeFile(AUTH_FILE, JSON.stringify(auth), { mode: 0o600 });
  } catch {
    /* Vercel-fs is read-only; de database is dan de bron */
  }
}

async function readAuthDb(): Promise<TikTokAdsAuth | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("tiktok_ads_account")
      .select("access_token, refresh_token, advertiser_ids, updated_at")
      .limit(1)
      .maybeSingle();
    if (error || !data?.access_token) return null;
    return {
      access_token: String(data.access_token),
      refresh_token: data.refresh_token ? String(data.refresh_token) : null,
      advertiser_ids: Array.isArray(data.advertiser_ids)
        ? data.advertiser_ids.map(String)
        : [],
      updated_at: data.updated_at
        ? String(data.updated_at)
        : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

async function readAuthStorage(): Promise<TikTokAdsAuth | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.storage.from(AUTH_BUCKET).download(AUTH_OBJECT);
    if (error || !data) return null;
    const parsed = JSON.parse(await data.text()) as TikTokAdsAuth;
    if (!parsed?.access_token) return null;
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token || null,
      advertiser_ids: Array.isArray(parsed.advertiser_ids)
        ? parsed.advertiser_ids.map(String)
        : [],
      updated_at: parsed.updated_at || new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

async function writeAuthStorage(auth: TikTokAdsAuth): Promise<boolean> {
  try {
    const sb = getSupabaseAdmin();
    const { data: buckets } = await sb.storage.listBuckets();
    if (!buckets?.some((b) => b.name === AUTH_BUCKET)) {
      const created = await sb.storage.createBucket(AUTH_BUCKET, { public: false });
      if (created.error && !/already exists/i.test(created.error.message)) {
        return false;
      }
    }
    const body = new Blob([JSON.stringify(auth)], { type: "application/json" });
    const up = await sb.storage.from(AUTH_BUCKET).upload(AUTH_OBJECT, body, {
      upsert: true,
      contentType: "application/json",
    });
    return !up.error;
  } catch {
    return false;
  }
}

async function writeAuthDb(auth: TikTokAdsAuth): Promise<boolean> {
  try {
    const sb = getSupabaseAdmin();
    const row = {
      access_token: auth.access_token,
      refresh_token: auth.refresh_token,
      advertiser_ids: auth.advertiser_ids,
      updated_at: auth.updated_at,
    };
    const { data } = await sb
      .from("tiktok_ads_account")
      .select("id")
      .limit(1)
      .maybeSingle();
    const res = data?.id
      ? await sb.from("tiktok_ads_account").update(row).eq("id", data.id)
      : await sb.from("tiktok_ads_account").insert(row);
    return !res.error;
  } catch {
    return false;
  }
}

export async function saveTikTokAdsAuth(auth: TikTokAdsAuth): Promise<void> {
  await Promise.all([writeAuthFile(auth), writeAuthDb(auth), writeAuthStorage(auth)]);
}

export async function loadTikTokAdsAuth(): Promise<TikTokAdsAuth | null> {
  const db = await readAuthDb();
  if (db?.access_token) return db;
  const stored = await readAuthStorage();
  if (stored?.access_token) return stored;
  const file = await readAuthFile();
  if (file?.access_token) return file;
  return envAuth();
}

export function tiktokAdsConfigured(): boolean {
  return Boolean(appSecret() || process.env.TIKTOK_ADS_ACCESS_TOKEN?.trim());
}

async function tiktokPost<T>(
  pathName: string,
  body: Record<string, unknown>,
  token?: string
): Promise<TikTokEnvelope<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Access-Token"] = token;
  const res = await fetch(`${API}${pathName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return (await res.json()) as TikTokEnvelope<T>;
}

async function tiktokGet<T>(
  pathName: string,
  token: string,
  params: Record<string, string>
): Promise<TikTokEnvelope<T>> {
  const u = new URL(`${API}${pathName}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { "Access-Token": token } });
  return (await res.json()) as TikTokEnvelope<T>;
}

function tiktokError(body: TikTokEnvelope<unknown>, fallback: string): string {
  const msg = (body.message || fallback).replace(/access[_ ]?token[=: ]+\S+/gi, "access_token");
  return `TikTok ${body.code ?? "?"}: ${msg}`;
}

async function listAdvertiserIds(token: string): Promise<string[]> {
  const secret = appSecret();
  if (!secret) return [];
  const body = await tiktokGet<{
    list?: { advertiser_id?: string | number }[];
  }>("/oauth2/advertiser/get/", token, {
    app_id: tiktokAppId(),
    secret,
  });
  if (body.code !== 0) return [];
  return (body.data?.list || [])
    .map((r) => String(r.advertiser_id || ""))
    .filter(Boolean);
}

export async function exchangeTikTokAuthCode(
  authCode: string
): Promise<TikTokAdsAuth> {
  const secret = appSecret();
  if (!secret) {
    throw new Error("TIKTOK_APP_SECRET ontbreekt");
  }
  const body = await tiktokPost<{
    access_token?: string;
    refresh_token?: string;
    advertiser_ids?: Array<string | number>;
  }>("/oauth2/access_token/", {
    app_id: tiktokAppId(),
    secret,
    auth_code: authCode.trim(),
  });
  if (body.code !== 0 || !body.data?.access_token) {
    throw new Error(tiktokError(body, "TikTok-login mislukt"));
  }
  let advertiserIds = (body.data.advertiser_ids || []).map(String).filter(Boolean);
  if (!advertiserIds.length) {
    advertiserIds = await listAdvertiserIds(body.data.access_token);
  }
  const auth: TikTokAdsAuth = {
    access_token: body.data.access_token,
    refresh_token: body.data.refresh_token || null,
    advertiser_ids: advertiserIds,
    updated_at: new Date().toISOString(),
  };
  await saveTikTokAdsAuth(auth);
  return auth;
}

async function refreshTikTokAuth(current: TikTokAdsAuth): Promise<TikTokAdsAuth | null> {
  const secret = appSecret();
  if (!secret || !current.refresh_token) return null;
  const body = await tiktokPost<{
    access_token?: string;
    refresh_token?: string;
    advertiser_ids?: Array<string | number>;
  }>("/oauth2/refresh_token/", {
    app_id: tiktokAppId(),
    secret,
    refresh_token: current.refresh_token,
  });
  if (body.code !== 0 || !body.data?.access_token) return null;
  const ids = (body.data.advertiser_ids || []).map(String).filter(Boolean);
  const next: TikTokAdsAuth = {
    access_token: body.data.access_token,
    refresh_token: body.data.refresh_token || current.refresh_token,
    advertiser_ids: ids.length ? ids : current.advertiser_ids,
    updated_at: new Date().toISOString(),
  };
  await saveTikTokAdsAuth(next);
  return next;
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateChunks(
  since: string,
  until: string,
  size = 30
): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let cursor = since;
  while (cursor <= until) {
    const end = addDaysYmd(cursor, size - 1);
    const capped = end > until ? until : end;
    out.push({ start: cursor, end: capped });
    cursor = addDaysYmd(capped, 1);
  }
  return out;
}

type ReportRow = {
  dimensions?: {
    campaign_id?: string | number;
    stat_time_day?: string;
  };
  metrics?: {
    campaign_name?: string;
    spend?: string | number;
    impressions?: string | number;
    clicks?: string | number;
  };
  campaign_id?: string | number;
  stat_time_day?: string;
  campaign_name?: string;
  spend?: string | number;
};

function num(v: string | number | undefined): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchAdvertiserCampaigns(
  token: string,
  advertiserId: string,
  since: string,
  until: string
): Promise<{ rows: MarketingMetaRow[]; error?: string; expired?: boolean }> {
  const rows: MarketingMetaRow[] = [];
  for (const chunk of dateChunks(since, until)) {
    let page = 1;
    let total = 1;
    while (page <= total && page <= 25) {
      const body = await tiktokGet<{
        list?: ReportRow[];
        page_info?: { total_page?: number };
      }>("/report/integrated/get/", token, {
        advertiser_id: advertiserId,
        service_type: "AUCTION",
        report_type: "BASIC",
        data_level: "AUCTION_CAMPAIGN",
        dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
        metrics: JSON.stringify([
          "campaign_name",
          "spend",
          "impressions",
          "clicks",
        ]),
        start_date: chunk.start,
        end_date: chunk.end,
        page: String(page),
        page_size: "1000",
      });
      if (body.code === 40102 || body.code === 40105 || body.code === 40100) {
        return { rows, expired: true, error: tiktokError(body, "token verlopen") };
      }
      if (body.code !== 0) {
        return { rows, error: tiktokError(body, "rapport mislukt") };
      }
      total = body.data?.page_info?.total_page || 1;
      for (const row of body.data?.list || []) {
        const dims = row.dimensions || row;
        const metrics = row.metrics || row;
        const datum = String(dims.stat_time_day || "").slice(0, 10);
        const spend = Math.round(num(metrics.spend) * 100) / 100;
        if (!datum || spend <= 0) continue;
        rows.push({
          datum,
          level: "campaign",
          campaign_id: String(dims.campaign_id || ""),
          campaign_name: (metrics.campaign_name || "").trim() || null,
          spend,
          source: "TikTok",
        });
      }
      page += 1;
    }
  }
  return { rows };
}

async function persistSpend(rows: MarketingMetaRow[], since: string, until: string) {
  if (!rows.length) return;
  try {
    const sb = getSupabaseAdmin();
    const del = await sb
      .from("tiktok_ad_spend")
      .delete()
      .gte("datum", since)
      .lte("datum", until);
    if (del.error) return;
    const payload = rows.map((r) => ({
      datum: r.datum,
      campaign_id: r.campaign_id || "",
      campaign_name: r.campaign_name,
      spend: r.spend,
      synced_at: new Date().toISOString(),
    }));
    for (let i = 0; i < payload.length; i += 200) {
      await sb.from("tiktok_ad_spend").insert(payload.slice(i, i + 200));
    }
  } catch {
    /* tabel optioneel */
  }
}

async function loadSpendDb(
  since: string,
  until: string
): Promise<MarketingMetaRow[]> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("tiktok_ad_spend")
      .select("datum, campaign_id, campaign_name, spend")
      .gte("datum", since)
      .lte("datum", until);
    if (error || !data) return [];
    return data.map((r) => ({
      datum: String(r.datum).slice(0, 10),
      level: "campaign",
      campaign_id: r.campaign_id ? String(r.campaign_id) : null,
      campaign_name: r.campaign_name ? String(r.campaign_name) : null,
      spend: Number(r.spend) || 0,
      source: "TikTok" as const,
    }));
  } catch {
    return [];
  }
}

export async function fetchTikTokCampaignRows(options: {
  since: string;
  until: string;
}): Promise<{
  configured: boolean;
  rows: MarketingMetaRow[];
  error?: string;
  advertiserIds: string[];
}> {
  let auth = await loadTikTokAdsAuth();
  if (!auth?.access_token) {
    return {
      configured: false,
      rows: [],
      advertiserIds: [],
      error: appSecret()
        ? "TikTok-account nog niet gekoppeld"
        : "TIKTOK_APP_SECRET ontbreekt",
    };
  }

  if (!auth.advertiser_ids.length) {
    auth.advertiser_ids = await listAdvertiserIds(auth.access_token);
    if (auth.advertiser_ids.length) await saveTikTokAdsAuth(auth);
  }
  if (!auth.advertiser_ids.length) {
    const cached = await loadSpendDb(options.since, options.until);
    return {
      configured: true,
      rows: cached,
      advertiserIds: [],
      error: cached.length
        ? undefined
        : "Geen TikTok-adverteerder gekoppeld aan deze app",
    };
  }

  const pull = async (tokenAuth: TikTokAdsAuth) => {
    const rows: MarketingMetaRow[] = [];
    let error: string | undefined;
    let expired = false;
    for (const id of tokenAuth.advertiser_ids) {
      const part = await fetchAdvertiserCampaigns(
        tokenAuth.access_token,
        id,
        options.since,
        options.until
      );
      rows.push(...part.rows);
      if (part.expired) expired = true;
      if (part.error) error = part.error;
    }
    return { rows, error, expired };
  };

  let result = await pull(auth);
  if (result.expired) {
    const refreshed = await refreshTikTokAuth(auth);
    if (refreshed) {
      auth = refreshed;
      result = await pull(auth);
    }
  }

  if (result.rows.length) {
    await persistSpend(result.rows, options.since, options.until);
    return {
      configured: true,
      rows: result.rows,
      advertiserIds: auth.advertiser_ids,
      error: result.error,
    };
  }

  const cached = await loadSpendDb(options.since, options.until);
  return {
    configured: true,
    rows: cached,
    advertiserIds: auth.advertiser_ids,
    error: result.error,
  };
}

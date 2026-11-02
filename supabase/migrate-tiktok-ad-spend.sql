-- TikTok Ads: token + dagelijkse campagnesperk.
-- Service-role only (geen anon-policy): het access token blijft server-side.

create table if not exists public.tiktok_ads_account (
  id              uuid primary key default gen_random_uuid(),
  access_token    text not null,
  refresh_token   text,
  advertiser_ids  text[] not null default '{}',
  updated_at      timestamptz not null default now()
);

alter table public.tiktok_ads_account enable row level security;

create table if not exists public.tiktok_ad_spend (
  id             uuid primary key default gen_random_uuid(),
  datum          date not null,
  campaign_id    text not null default '',
  campaign_name  text,
  spend          numeric(12,2) not null default 0,
  synced_at      timestamptz not null default now()
);

create unique index if not exists tiktok_ad_spend_unique_idx
  on public.tiktok_ad_spend (datum, campaign_id);

create index if not exists tiktok_ad_spend_datum_idx
  on public.tiktok_ad_spend (datum);

alter table public.tiktok_ad_spend enable row level security;

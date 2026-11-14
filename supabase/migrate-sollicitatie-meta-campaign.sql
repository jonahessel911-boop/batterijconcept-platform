-- Campagne-/ad-attributie vanaf Meta BANEN (URL-params + UTM op sollicitatie)
alter table public.sollicitaties
  add column if not exists meta_campaign_id text null,
  add column if not exists meta_adset_id text null,
  add column if not exists meta_ad_id text null,
  add column if not exists campaign_name text null,
  add column if not exists adset_name text null,
  add column if not exists ad_name text null,
  add column if not exists utm_source text null,
  add column if not exists utm_medium text null,
  add column if not exists utm_campaign text null,
  add column if not exists utm_content text null,
  add column if not exists utm_term text null,
  add column if not exists landing_url text null,
  add column if not exists meta_placement text null,
  add column if not exists meta_fbc text null,
  add column if not exists meta_fbp text null;

create index if not exists idx_sollicitaties_meta_campaign_id
  on public.sollicitaties(meta_campaign_id)
  where meta_campaign_id is not null;

create index if not exists idx_sollicitaties_meta_adset_id
  on public.sollicitaties(meta_adset_id)
  where meta_adset_id is not null;

create index if not exists idx_sollicitaties_meta_ad_id
  on public.sollicitaties(meta_ad_id)
  where meta_ad_id is not null;

create index if not exists idx_sollicitaties_utm_source
  on public.sollicitaties(utm_source)
  where utm_source is not null;

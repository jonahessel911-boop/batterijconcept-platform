-- =============================================================================
-- Lead attribution: lander, campaign_name, ad_name
-- Run in Supabase SQL Editor
-- =============================================================================

alter table public.leads
  add column if not exists lander text,
  add column if not exists campaign_name text,
  add column if not exists ad_name text;

create index if not exists leads_lander_idx
  on public.leads (lander)
  where lander is not null;

create index if not exists leads_campaign_name_idx
  on public.leads (campaign_name)
  where campaign_name is not null;

comment on column public.leads.lander is
  'Landing page / lander waar de lead vandaan komt (webhook).';
comment on column public.leads.campaign_name is
  'Campagnenaam (bijv. Meta/Google) via webhook.';
comment on column public.leads.ad_name is
  'Advertentienaam via webhook.';

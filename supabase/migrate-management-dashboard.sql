-- Management dashboard: doelstellingen + Meta spend detail (niet-destructief)
-- Run in Supabase SQL Editor

-- ─── Dashboardinstellingen (één actieve rij verwacht) ───────────────────────
create table if not exists public.dashboard_instellingen (
  id                          uuid primary key default gen_random_uuid(),
  -- Doelen (maand)
  omzet_doel_maand            numeric(12,2) not null default 150000,
  winst_doel_maand            numeric(12,2) not null default 45000,
  minimale_marge_pct          numeric(6,2) not null default 25,
  max_cpl                     numeric(10,2) not null default 75,
  max_kosten_per_afspraak     numeric(10,2) not null default 250,
  max_kosten_per_sale         numeric(10,2) not null default 1500,
  doel_lead_to_appointment    numeric(6,2) not null default 35,
  doel_show_rate              numeric(6,2) not null default 80,
  doel_closing_rate           numeric(6,2) not null default 25,
  -- Capaciteit defaults
  slots_per_adviseur_per_week integer not null default 24,
  installaties_per_week       integer not null default 20,
  -- Standaardkosten
  standaard_inkoop            numeric(12,2),
  standaard_installatie       numeric(12,2) not null default 675,
  verwachte_betaaltermijn_dagen integer not null default 14,
  max_doorlooptijd_fase_dagen integer not null default 21,
  -- Forecast
  forecast_lookback_dagen     integer not null default 60
    check (forecast_lookback_dagen in (30, 60, 90)),
  beginsaldo_cash             numeric(12,2),
  btw_reservering             numeric(12,2) not null default 0,
  -- Meta sync meta
  meta_laatste_sync_at        timestamptz,
  meta_laatste_sync_until     date,
  actief                      boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

comment on table public.dashboard_instellingen is
  'Doelstellingen en drempels voor het managementdashboard';

drop trigger if exists dashboard_instellingen_set_updated_at on public.dashboard_instellingen;
create trigger dashboard_instellingen_set_updated_at
  before update on public.dashboard_instellingen
  for each row execute function public.set_updated_at();

alter table public.dashboard_instellingen enable row level security;

drop policy if exists "crm_dashboard_instellingen_all" on public.dashboard_instellingen;
drop policy if exists "crm_dashboard_instellingen_anon" on public.dashboard_instellingen;
create policy "crm_dashboard_instellingen_all" on public.dashboard_instellingen
  for all to authenticated using (true) with check (true);
create policy "crm_dashboard_instellingen_anon" on public.dashboard_instellingen
  for all to anon using (true) with check (true);

insert into public.dashboard_instellingen (id)
select gen_random_uuid()
where not exists (select 1 from public.dashboard_instellingen where actief = true);

-- ─── Meta ad spend detail (campagne / adset / ad) ───────────────────────────
create table if not exists public.meta_ad_spend (
  id              uuid primary key default gen_random_uuid(),
  datum           date not null,
  level           text not null check (level in ('account', 'campaign', 'adset', 'ad')),
  campaign_id     text,
  campaign_name   text,
  adset_id        text,
  adset_name      text,
  ad_id           text,
  ad_name         text,
  spend           numeric(12,2) not null default 0,
  impressions     integer,
  clicks          integer,
  synced_at       timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- Unique zonder NULL-problemen
create unique index if not exists meta_ad_spend_unique_idx
  on public.meta_ad_spend (
    datum,
    level,
    coalesce(campaign_id, ''),
    coalesce(adset_id, ''),
    coalesce(ad_id, '')
  );

create index if not exists meta_ad_spend_datum_idx on public.meta_ad_spend (datum);
create index if not exists meta_ad_spend_campaign_idx on public.meta_ad_spend (campaign_name);
create index if not exists meta_ad_spend_level_idx on public.meta_ad_spend (level);

alter table public.meta_ad_spend enable row level security;

drop policy if exists "crm_meta_ad_spend_all" on public.meta_ad_spend;
drop policy if exists "crm_meta_ad_spend_anon" on public.meta_ad_spend;
create policy "crm_meta_ad_spend_all" on public.meta_ad_spend
  for all to authenticated using (true) with check (true);
create policy "crm_meta_ad_spend_anon" on public.meta_ad_spend
  for all to anon using (true) with check (true);

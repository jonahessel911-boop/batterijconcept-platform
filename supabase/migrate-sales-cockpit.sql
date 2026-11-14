-- Salescockpit: uitsluitend nieuwe tabellen.
-- Niet automatisch uitvoeren. Bestaande tabellen, kolommen en policies blijven onaangeroerd.
-- Geen policies voor anon/authenticated: alleen de server (service role) schrijft hier.
-- Service role omzeilt RLS; de browser krijgt deze tabellen niet.

create table if not exists public.sales_cockpit_settings (
  id text primary key default 'default',
  waarden jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

create table if not exists public.sales_cockpit_week_targets (
  id uuid primary key default gen_random_uuid(),
  adviseur_id uuid not null,
  week_key text not null,
  gelopen_target integer null,
  deals_target integer null,
  conversie_target numeric(5,2) null,
  verbeterafspraak text null,
  version integer not null,
  created_at timestamptz not null default now(),
  created_by uuid null,
  created_by_naam text null
);

create index if not exists sales_cockpit_week_targets_lookup_idx
  on public.sales_cockpit_week_targets (adviseur_id, week_key, created_at desc);

create table if not exists public.sales_cockpit_actions (
  id uuid primary key default gen_random_uuid(),
  signal_key text not null unique,
  adviseur_id uuid null,
  soort text not null,
  status text not null default 'nieuw',
  titel text not null,
  observatie text null,
  kpi text null,
  uitgangswaarde text null,
  gewenste_verbetering text null,
  actie text null,
  verantwoordelijke text null,
  aandacht text null,
  evaluatie_op date null,
  uitgesteld_tot date null,
  resultaat text null,
  omstandigheden text null,
  oorzaak_buiten_sales text null,
  prioriteit integer null,
  toelichting text null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

create table if not exists public.sales_cockpit_snapshots (
  id uuid primary key default gen_random_uuid(),
  week_key text not null,
  soort text not null,
  opgenomen_at timestamptz not null default now(),
  bron_van date not null,
  bron_tot date not null,
  payload jsonb not null,
  unique (week_key, soort)
);

create table if not exists public.sales_cockpit_evaluations (
  id uuid primary key default gen_random_uuid(),
  week_key text not null,
  vastgelegd_at timestamptz not null default now(),
  vastgelegd_door uuid null,
  vastgelegd_door_naam text null,
  bronkwaliteit jsonb not null default '{}'::jsonb,
  beeld jsonb not null default '{}'::jsonb
);

create index if not exists sales_cockpit_evaluations_week_idx
  on public.sales_cockpit_evaluations (week_key, vastgelegd_at desc);

alter table public.sales_cockpit_settings enable row level security;
alter table public.sales_cockpit_week_targets enable row level security;
alter table public.sales_cockpit_actions enable row level security;
alter table public.sales_cockpit_snapshots enable row level security;
alter table public.sales_cockpit_evaluations enable row level security;

-- Adviseur ZZP-gegevens + creditfacturen (verkoperscommissie op aanbetalingen)
-- Run in Supabase SQL Editor

alter table public.adviseurs
  add column if not exists bedrijfsnaam text,
  add column if not exists kvk_nummer text,
  add column if not exists btw_nummer text,
  add column if not exists factuur_adres text,
  add column if not exists factuur_postcode text,
  add column if not exists factuur_plaats text,
  add column if not exists iban text,
  add column if not exists max_factuur_bedrag numeric(12,2);

comment on column public.adviseurs.max_factuur_bedrag is
  'Maximaal bedrag per creditfactuur (excl. btw). Null = geen limiet.';

create table if not exists public.adviseur_creditfacturen (
  id              uuid primary key default gen_random_uuid(),
  adviseur_id     uuid not null references public.adviseurs(id) on delete cascade,
  factuur_nummer  text not null unique,
  status          text not null default 'concept'
                  check (status in ('concept', 'goedgekeurd', 'betaald', 'geannuleerd')),
  week_jaar       integer not null,
  week_nummer     integer not null check (week_nummer between 1 and 53),
  periode_van     date not null,
  periode_tot     date not null,
  aantal_aanbetalingen integer not null default 0,
  bedrag_ex_btw   numeric(12,2) not null default 0,
  btw_bedrag      numeric(12,2) not null default 0,
  bedrag_inc_btw  numeric(12,2) not null default 0,
  max_bedrag_toegepast numeric(12,2),
  factuurdatum    date not null default (timezone('Europe/Amsterdam', now()))::date,
  betaald_op      date,
  notities        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (adviseur_id, week_jaar, week_nummer)
);

create index if not exists adviseur_creditfacturen_adviseur_idx
  on public.adviseur_creditfacturen (adviseur_id, week_jaar desc, week_nummer desc);

create table if not exists public.adviseur_creditfactuur_regels (
  id               uuid primary key default gen_random_uuid(),
  creditfactuur_id uuid not null references public.adviseur_creditfacturen(id) on delete cascade,
  factuur_id       uuid not null references public.facturen(id) on delete restrict,
  lead_id          uuid references public.leads(id) on delete set null,
  bedrag           numeric(12,2) not null default 250,
  omschrijving     text,
  created_at       timestamptz not null default now(),
  unique (factuur_id)
);

create index if not exists adviseur_creditfactuur_regels_cf_idx
  on public.adviseur_creditfactuur_regels (creditfactuur_id);

drop trigger if exists adviseur_creditfacturen_set_updated_at on public.adviseur_creditfacturen;
create trigger adviseur_creditfacturen_set_updated_at
  before update on public.adviseur_creditfacturen
  for each row execute function public.set_updated_at();

alter table public.adviseur_creditfacturen enable row level security;
alter table public.adviseur_creditfactuur_regels enable row level security;

drop policy if exists "crm_creditfacturen_all" on public.adviseur_creditfacturen;
drop policy if exists "crm_creditfacturen_anon" on public.adviseur_creditfacturen;
create policy "crm_creditfacturen_all" on public.adviseur_creditfacturen
  for all to authenticated using (true) with check (true);
create policy "crm_creditfacturen_anon" on public.adviseur_creditfacturen
  for all to anon using (true) with check (true);

drop policy if exists "crm_creditfactuur_regels_all" on public.adviseur_creditfactuur_regels;
drop policy if exists "crm_creditfactuur_regels_anon" on public.adviseur_creditfactuur_regels;
create policy "crm_creditfactuur_regels_all" on public.adviseur_creditfactuur_regels
  for all to authenticated using (true) with check (true);
create policy "crm_creditfactuur_regels_anon" on public.adviseur_creditfactuur_regels
  for all to anon using (true) with check (true);

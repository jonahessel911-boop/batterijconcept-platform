-- Adviseur beschikbaarheid per week + commissie-%
-- Run in Supabase SQL Editor

alter table public.adviseurs
  add column if not exists commissie_pct numeric(5,2) not null default 0;

comment on column public.adviseurs.commissie_pct is
  'Commissie-percentage over omzet (excl. btw) — sales-kosten voor Financial Dashboard';

create table if not exists public.adviseur_beschikbaarheid (
  id         uuid primary key default gen_random_uuid(),
  adviseur_id uuid not null references public.adviseurs(id) on delete cascade,
  jaar       integer not null,
  week       integer not null check (week between 1 and 53),
  beschikbaar boolean not null default true,
  notitie    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (adviseur_id, jaar, week)
);

create index if not exists adviseur_beschikbaarheid_week_idx
  on public.adviseur_beschikbaarheid (jaar, week);

drop trigger if exists adviseur_beschikbaarheid_set_updated_at on public.adviseur_beschikbaarheid;
create trigger adviseur_beschikbaarheid_set_updated_at
  before update on public.adviseur_beschikbaarheid
  for each row execute function public.set_updated_at();

alter table public.adviseur_beschikbaarheid enable row level security;

drop policy if exists "crm_beschikbaarheid_all" on public.adviseur_beschikbaarheid;
drop policy if exists "crm_beschikbaarheid_anon" on public.adviseur_beschikbaarheid;
create policy "crm_beschikbaarheid_all" on public.adviseur_beschikbaarheid
  for all to authenticated using (true) with check (true);
create policy "crm_beschikbaarheid_anon" on public.adviseur_beschikbaarheid
  for all to anon using (true) with check (true);

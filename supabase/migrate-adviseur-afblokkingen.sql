-- Afblokken per tijdsblok (10:00 / 13:00 / 16:00 / 19:00) per adviseur per dag
-- Run in Supabase SQL Editor

create table if not exists public.adviseur_afblokkingen (
  id          uuid primary key default gen_random_uuid(),
  adviseur_id uuid not null references public.adviseurs(id) on delete cascade,
  dag         date not null,
  slot_hour   integer not null check (slot_hour in (10, 13, 16, 19)),
  created_at  timestamptz not null default now(),
  unique (adviseur_id, dag, slot_hour)
);

create index if not exists adviseur_afblokkingen_range_idx
  on public.adviseur_afblokkingen (adviseur_id, dag);

comment on table public.adviseur_afblokkingen is
  'Geblokkeerde vaste afspraakblokken; op deze slots kan niet worden gepland';

alter table public.adviseur_afblokkingen enable row level security;

drop policy if exists "crm_afblokkingen_all" on public.adviseur_afblokkingen;
drop policy if exists "crm_afblokkingen_anon" on public.adviseur_afblokkingen;
create policy "crm_afblokkingen_all" on public.adviseur_afblokkingen
  for all to authenticated using (true) with check (true);
create policy "crm_afblokkingen_anon" on public.adviseur_afblokkingen
  for all to anon using (true) with check (true);

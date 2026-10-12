-- Vrijgave van standaard-geblokkeerde slots (nu: zondag).
-- Zondag blijft standaard dicht; een rij hier = slot is open voor plannen.
-- Run in Supabase SQL Editor

create table if not exists public.adviseur_slot_vrijgaven (
  id          uuid primary key default gen_random_uuid(),
  adviseur_id uuid not null references public.adviseurs(id) on delete cascade,
  dag         date not null,
  slot_hour   integer not null check (slot_hour in (10, 13, 16, 19)),
  created_at  timestamptz not null default now(),
  unique (adviseur_id, dag, slot_hour)
);

create index if not exists adviseur_slot_vrijgaven_range_idx
  on public.adviseur_slot_vrijgaven (adviseur_id, dag);

comment on table public.adviseur_slot_vrijgaven is
  'Uitzonderingen op standaard-blokkades (zondag). Aanwezig = slot open.';

alter table public.adviseur_slot_vrijgaven enable row level security;

drop policy if exists "crm_slot_vrijgaven_all" on public.adviseur_slot_vrijgaven;
drop policy if exists "crm_slot_vrijgaven_anon" on public.adviseur_slot_vrijgaven;
create policy "crm_slot_vrijgaven_all" on public.adviseur_slot_vrijgaven
  for all to authenticated using (true) with check (true);
create policy "crm_slot_vrijgaven_anon" on public.adviseur_slot_vrijgaven
  for all to anon using (true) with check (true);

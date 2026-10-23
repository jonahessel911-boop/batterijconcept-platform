-- Partner-agenda: startadres + afblokken ochtend/middag
-- Run in Supabase SQL Editor

-- Startadres + reistijd-buffer per installatiepartner
alter table public.installatie_partners
  add column if not exists start_adres text;

alter table public.installatie_partners
  add column if not exists reistijd_buffer_min integer not null default 30;

comment on column public.installatie_partners.start_adres is
  'Vertrekadres voor reistijd bij schouw/installatie-planning';

comment on column public.installatie_partners.reistijd_buffer_min is
  'Fallback reistijd-buffer in minuten als route niet bekend is (default 30)';

-- Afblokken per planvenster (ochtend 09-12 / middag 13-17)
create table if not exists public.partner_afblokkingen (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.installatie_partners(id) on delete cascade,
  dag         date not null,
  venster     text not null check (venster in ('ochtend', 'middag')),
  created_at  timestamptz not null default now(),
  unique (partner_id, dag, venster)
);

create index if not exists partner_afblokkingen_range_idx
  on public.partner_afblokkingen (partner_id, dag);

comment on table public.partner_afblokkingen is
  'Geblokkeerde partner-planvensters (ochtend/middag); op deze vensters kan niet worden gepland';

alter table public.partner_afblokkingen enable row level security;

drop policy if exists "crm_partner_afblokkingen_all" on public.partner_afblokkingen;
drop policy if exists "crm_partner_afblokkingen_anon" on public.partner_afblokkingen;
create policy "crm_partner_afblokkingen_all" on public.partner_afblokkingen
  for all to authenticated using (true) with check (true);
create policy "crm_partner_afblokkingen_anon" on public.partner_afblokkingen
  for all to anon using (true) with check (true);

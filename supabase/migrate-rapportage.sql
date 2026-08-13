-- Projectkosten + dagelijkse ad spend / sales kosten voor Rapportage
-- Run in Supabase SQL Editor

alter table public.projecten
  add column if not exists projectkosten numeric(12,2) not null default 0;

comment on column public.projecten.projectkosten is
  'Interne projectkosten (excl. btw); gaan van omzet af in Rapportage';

create table if not exists public.rapportage_kosten (
  id           uuid primary key default gen_random_uuid(),
  datum        date not null,
  soort        text not null check (soort in ('ad_spend', 'sales')),
  bedrag       numeric(12,2) not null default 0,
  adviseur_id  uuid references public.adviseurs(id) on delete set null,
  notities     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (datum, soort, adviseur_id)
);

create index if not exists rapportage_kosten_datum_idx
  on public.rapportage_kosten (datum);
create index if not exists rapportage_kosten_soort_idx
  on public.rapportage_kosten (soort);

drop trigger if exists rapportage_kosten_set_updated_at on public.rapportage_kosten;
create trigger rapportage_kosten_set_updated_at
  before update on public.rapportage_kosten
  for each row execute function public.set_updated_at();

alter table public.rapportage_kosten enable row level security;

drop policy if exists "crm_rapportage_kosten_all" on public.rapportage_kosten;
drop policy if exists "crm_rapportage_kosten_anon" on public.rapportage_kosten;

create policy "crm_rapportage_kosten_all" on public.rapportage_kosten
  for all to authenticated using (true) with check (true);
create policy "crm_rapportage_kosten_anon" on public.rapportage_kosten
  for all to anon using (true) with check (true);

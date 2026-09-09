-- Eerste belpoging / first contact voor TTFC-rapportage
-- Run in Supabase SQL Editor

alter table public.leads
  add column if not exists eerste_gebeld_at timestamptz;

comment on column public.leads.eerste_gebeld_at is
  'Tijdstip van de eerste belpoging vanuit het belsysteem (TTFC)';

-- Best-effort backfill: alleen betrouwbaar bij precies 1 belpoging
update public.leads
set eerste_gebeld_at = laatst_gebeld_at
where eerste_gebeld_at is null
  and belpogingen = 1
  and laatst_gebeld_at is not null;

create index if not exists leads_eerste_gebeld_at_idx
  on public.leads (eerste_gebeld_at)
  where eerste_gebeld_at is not null;

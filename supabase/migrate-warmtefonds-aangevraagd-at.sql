-- Datum wanneer Warmtefonds-aanvraag is ingediend (portaal / CRM)
-- Run in Supabase SQL Editor

alter table public.projecten
  add column if not exists warmtefonds_aangevraagd_at timestamptz;

comment on column public.projecten.warmtefonds_aangevraagd_at is
  'Moment waarop de Warmtefonds-aanvraag is ingediend (status aanvraag_gedaan).';

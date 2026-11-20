-- Timestamp van de laatste Warmtefonds-fasewijziging (Acties: wachten op uitbetaling).

begin;

alter table public.projecten
  add column if not exists financiering_status_at timestamptz;

comment on column public.projecten.financiering_status_at is
  'Laatste wijziging van financiering_status (WF-fase).';

commit;

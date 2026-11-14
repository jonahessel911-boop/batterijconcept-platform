-- Moment waarop Warmtefonds-declaratie is uitbetaald (volgen naast financiering_status).
alter table public.projecten
  add column if not exists warmtefonds_uitbetaald_at timestamptz;

comment on column public.projecten.warmtefonds_uitbetaald_at is
  'Wanneer de Warmtefonds-declaratie is uitbetaald (status uitbetaald).';

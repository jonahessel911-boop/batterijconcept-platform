-- Warmtefonds: schakelen met financieringsman
alter table public.projecten
  add column if not exists financiering_geschakeld_at timestamptz;

comment on column public.projecten.financiering_geschakeld_at is
  'Wanneer backoffice met financieringsman heeft geschakeld (alleen Warmtefonds); null = open actie';

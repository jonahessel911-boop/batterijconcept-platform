-- Locatie voor fysiek sollicitatiegesprek (standaard Daltonlaan 500, Utrecht)
alter table public.sollicitatie_afspraken
  add column if not exists locatie text null;

comment on column public.sollicitatie_afspraken.locatie is
  'Adres voor fysiek gesprek; null = standaard Daltonlaan of telefonisch.';

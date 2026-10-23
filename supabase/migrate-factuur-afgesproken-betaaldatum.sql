-- Afgesproken betaaldatum per factuur (klant belooft later te betalen dan vervaldatum).
-- Tot die dag: geen "verlopen" / geen nabellen-actie.
-- Run in Supabase SQL Editor

alter table public.facturen
  add column if not exists afgesproken_betaaldatum date;

comment on column public.facturen.afgesproken_betaaldatum is
  'Afgesproken betaaldatum met de klant. Zolang deze dag niet voorbij is, telt de factuur niet als verlopen (ook als vervaldatum eerder is).';

-- PRIO omplannen: vaste afboeking + koppeling geannuleerde → nieuwe afspraak.
-- Voer uit in Supabase SQL editor. Idempotent (herhaalbaar).

alter table public.afspraken
  add column if not exists annulering_code text null;

alter table public.afspraken
  drop constraint if exists afspraken_annulering_code_check;

alter table public.afspraken
  add constraint afspraken_annulering_code_check
  check (annulering_code is null or annulering_code = 'prio_omplannen');

comment on column public.afspraken.annulering_code is
  'Vaste afboeking bij annuleren. prio_omplannen = admin PRIO-omplannen (niet in normale annuleringen-bak, niet in setter-KPI).';

alter table public.afspraken
  add column if not exists herpland_van_afspraak_id uuid null
    references public.afspraken(id) on delete set null;

comment on column public.afspraken.herpland_van_afspraak_id is
  'Nieuwe afspraak vanuit PRIO omplannen: id van de geannuleerde afspraak.';

create index if not exists idx_afspraken_annulering_code
  on public.afspraken (annulering_code)
  where annulering_code is not null;

create index if not exists idx_afspraken_herpland_van
  on public.afspraken (herpland_van_afspraak_id)
  where herpland_van_afspraak_id is not null;

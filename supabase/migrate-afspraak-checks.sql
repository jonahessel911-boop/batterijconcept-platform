-- Verplichte checks bij inplannen afspraak
alter table public.afspraken
  add column if not exists partner_aanwezig boolean,
  add column if not exists andere_offertes_gehad boolean;

comment on column public.afspraken.partner_aanwezig is
  'Partner aanwezig bij de afspraak? (ja/nee)';
comment on column public.afspraken.andere_offertes_gehad is
  'Klant heeft al andere offertes gehad? (ja/nee)';

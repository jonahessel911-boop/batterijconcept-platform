-- Leadstatus na afspraak + afspraaksoort (fysiek vs telefonisch)

alter table public.leads drop constraint if exists leads_status_check;

alter table public.leads
  add constraint leads_status_check
  check (status in (
    'nieuw',
    'afspraak',
    'na_afspraak',
    'vervolg_fysiek',
    'vervolg_tel',
    'vervolg_geen_contact',
    'offerte_afgewezen',
    'niet_gekwalificeerd',
    'geen_interesse',
    'geen_contact',
    'deal'
  ));

alter table public.afspraken
  add column if not exists soort text not null default 'nieuw';

alter table public.afspraken
  drop constraint if exists afspraken_soort_check;

alter table public.afspraken
  add constraint afspraken_soort_check
  check (soort in ('nieuw', 'bel', 'vervolg_fysiek', 'vervolg_tel'));

comment on column public.afspraken.soort is
  'nieuw/vervolg_fysiek blokkeren de agenda; bel/vervolg_tel mogen overlappen.';

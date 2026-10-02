-- Warmtefonds-aanvraagafspraak: nieuwe afspraaksoort + projectstatus + datum
-- NIET automatisch uitvoeren — handmatig in Supabase.

begin;

-- 1. Afspraaksoort warmtefonds_aanvraag (geen klantmail, wel agenda)
alter table public.afspraken
  drop constraint if exists afspraken_soort_check;

alter table public.afspraken
  add constraint afspraken_soort_check
  check (soort in (
    'nieuw',
    'bel',
    'warme_bel',
    'vervolg_fysiek',
    'vervolg_tel',
    'vervolg_punt',
    'warmtefonds_aanvraag'
  ));

comment on column public.afspraken.soort is
  'nieuw/vervolg_fysiek blokkeren agenda; bel/warme_bel/vervolg_tel/vervolg_punt/warmtefonds_aanvraag mogen overlappen. warmtefonds_aanvraag: geen klantmail.';

-- 2. Projectstatus Warmtefonds afspraak ingepland
alter table public.projecten drop constraint if exists projecten_status_check;

alter table public.projecten
  add constraint projecten_status_check
  check (
    status in (
      'schouwweek_inplannen',
      'aanbetaling_verstuurd',
      'aanbetaling_betaald',
      'warmtefonds_afspraak_ingepland',
      'warmtefonds_aangevraagd',
      'warmtefonds_in_behandeling',
      'warmtefonds_afgewezen',
      'warmtefonds_goedgekeurd',
      'schouwdag_ingepland',
      'schouw_voltooid',
      'restfactuur_verstuurd',
      'restfactuur_betaald',
      'materiaal_besteld',
      'installatie_ingepland',
      'installatie_voltooid',
      'review_gevraagd',
      'service',
      'annulering',
      'hold_sales_actie'
    )
  );

-- 3. Datum wanneer Warmtefonds is aangevraagd
alter table public.projecten
  add column if not exists warmtefonds_aangevraagd_at timestamptz;

comment on column public.projecten.warmtefonds_aangevraagd_at is
  'Moment waarop de Warmtefonds-aanvraag is ingediend (status warmtefonds_aangevraagd).';

commit;

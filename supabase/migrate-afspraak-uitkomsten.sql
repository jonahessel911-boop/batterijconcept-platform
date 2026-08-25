-- =============================================================================
-- Afspraakuitkomsten (als migrate-platform-verbeteringen.sql al is gedraaid)
-- Run in Supabase SQL Editor
-- =============================================================================

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
    'deal',
    'sale_financiering',
    'sale_eigen_middelen',
    'deur_niet_open',
    'afspraak_afgezegd_klant',
    'huurwoning',
    'foutief_nummer',
    'gegevens_niet_overeen'
  ));

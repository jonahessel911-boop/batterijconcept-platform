-- Na 3x geen contact: status definitief_geen_contact
-- Run in Supabase SQL Editor

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
    'geen_interesse_al_batterij',
    'geen_interesse_plugin',
    'geen_interesse_alleen_info',
    'geen_interesse_vertrouwt_niet',
    'geen_contact',
    'definitief_geen_contact',
    'deal',
    'sale_financiering',
    'sale_eigen_middelen',
    'deur_niet_open',
    'afspraak_afgezegd_klant',
    'huurwoning',
    'foutief_nummer',
    'gegevens_niet_overeen'
  ));

-- Leads die al 3 of meer keer geen contact zijn: direct afboeken
update public.leads
set status = 'definitief_geen_contact'
where status = 'geen_contact'
  and coalesce(belpogingen, 0) >= 3;

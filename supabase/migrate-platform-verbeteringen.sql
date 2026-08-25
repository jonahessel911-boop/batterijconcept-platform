-- =============================================================================
-- Platform: nieuwe bel-statussen, warme terugbel, lead events
-- Run in Supabase SQL Editor
-- =============================================================================

-- Leadstatussen voor beluitkomsten + afspraakuitkomsten
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

-- Warme terugbel als aparte afspraaksoort (prioriteit in bellijst)
alter table public.afspraken
  drop constraint if exists afspraken_soort_check;

alter table public.afspraken
  add constraint afspraken_soort_check
  check (soort in (
    'nieuw',
    'bel',
    'vervolg_fysiek',
    'vervolg_tel',
    'vervolg_punt',
    'warme_bel'
  ));

comment on column public.afspraken.soort is
  'nieuw/vervolg_fysiek blokkeren agenda; bel/warme_bel/vervolg_tel/vervolg_punt mogen overlappen.';

-- Lead geschiedenis / tijdlijn
create table if not exists public.lead_events (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  soort       text not null,
  titel       text not null,
  detail      text,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists lead_events_lead_id_created_at_idx
  on public.lead_events (lead_id, created_at desc);

comment on table public.lead_events is
  'Audit/tijdlijn van gebeurtenissen per lead (status, bel, afspraak, …).';

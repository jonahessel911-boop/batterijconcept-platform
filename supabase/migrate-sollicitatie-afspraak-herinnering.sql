-- Herinneringsmail 2 dagen vóór sollicitatiegesprek

alter table public.sollicitatie_afspraken
  add column if not exists herinnering_verstuurd boolean not null default false;

comment on column public.sollicitatie_afspraken.herinnering_verstuurd is
  'Herinneringsmail ~2 dagen voor start verstuurd';

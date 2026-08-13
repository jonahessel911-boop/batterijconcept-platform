-- Afspraak mailsequentie: opwarm-flag
alter table public.afspraken
  add column if not exists opwarm_verstuurd boolean not null default false;

comment on column public.afspraken.opwarm_verstuurd is
  'Opwarm-mail (saldering) verstuurd tussen bevestiging en 24u-reminder';

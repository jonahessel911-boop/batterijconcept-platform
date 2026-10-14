-- Wie heeft de afspraak echt ingepland (beller/backoffice), los van adviseur_id (huisbezoek-planner).
alter table public.afspraken
  add column if not exists ingepland_door_id uuid
    references public.adviseurs(id) on delete set null;

create index if not exists afspraken_ingepland_door_idx
  on public.afspraken (ingepland_door_id)
  where ingepland_door_id is not null;

comment on column public.afspraken.ingepland_door_id is
  'Medewerker die de afspraak heeft ingepland (bel-credit). adviseur_id = wie het huisbezoek doet.';

-- Boeteclausule 3.3: afspraak niet gelopen door toerekenbare nalatigheid adviseur.

alter table public.afspraken
  add column if not exists niet_gelopen_door_adviseur boolean not null default false;

alter table public.afspraken
  add column if not exists niet_gelopen_door_adviseur_at timestamptz;

alter table public.afspraken
  add column if not exists niet_gelopen_door_adviseur_door uuid;

create index if not exists afspraken_niet_gelopen_adviseur_idx
  on public.afspraken (adviseur_id)
  where niet_gelopen_door_adviseur = true;

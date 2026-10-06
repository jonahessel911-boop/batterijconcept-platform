-- Adviseur kan vanuit Nettoboord een backoffice-actie aanmaken.
-- Run in Supabase SQL Editor.

alter table public.project_taken
  add column if not exists aangemaakt_door_id uuid
    references public.adviseurs(id) on delete set null;

alter table public.project_taken
  add column if not exists completed_notified_at timestamptz;

create index if not exists project_taken_aangemaakt_door_idx
  on public.project_taken (aangemaakt_door_id)
  where aangemaakt_door_id is not null;

comment on column public.project_taken.aangemaakt_door_id is
  'Adviseur die de actie heeft aangemaakt (bijv. vanuit Nettoboord)';
comment on column public.project_taken.completed_notified_at is
  'Wanneer de aanmaker is gemaild dat de actie is voltooid';

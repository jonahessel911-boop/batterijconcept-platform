-- Koppel bo_agenda-items aan een project (agenda-punt vanaf projectpagina).
-- Run in Supabase SQL Editor.

alter table public.bo_agenda
  add column if not exists project_id uuid null
  references public.projecten(id) on delete set null;

create index if not exists bo_agenda_project_idx
  on public.bo_agenda (project_id)
  where project_id is not null;

comment on column public.bo_agenda.project_id is
  'Optioneel project waar dit Taken-agenda-punt bij hoort';

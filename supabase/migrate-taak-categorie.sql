-- Categorie voor Taken-agenda (bo_agenda) en project_taken.
-- Run in Supabase SQL Editor.

-- bo_agenda
alter table public.bo_agenda
  add column if not exists categorie text null;

alter table public.bo_agenda
  drop constraint if exists bo_agenda_categorie_check;

alter table public.bo_agenda
  add constraint bo_agenda_categorie_check
  check (
    categorie is null
    or categorie in (
      'project',
      'facturatie',
      'bellen',
      'email',
      'kantoor',
      'overig'
    )
  );

comment on column public.bo_agenda.categorie is
  'Handmatige taakcategorie (project/facturatie/bellen/email/kantoor/overig)';

-- Bestaande rijen met projectkoppeling → Project
update public.bo_agenda
set categorie = 'project'
where project_id is not null
  and (categorie is null or categorie = '');

update public.bo_agenda
set categorie = 'overig'
where categorie is null;

-- project_taken
alter table public.project_taken
  add column if not exists categorie text null;

alter table public.project_taken
  drop constraint if exists project_taken_categorie_check;

alter table public.project_taken
  add constraint project_taken_categorie_check
  check (
    categorie is null
    or categorie in (
      'project',
      'facturatie',
      'bellen',
      'email',
      'kantoor',
      'overig'
    )
  );

comment on column public.project_taken.categorie is
  'Handmatige taakcategorie; default project (vanuit project)';

update public.project_taken
set categorie = 'project'
where categorie is null;

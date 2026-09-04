-- Kanban-statussen + materiaal-inkoop velden
-- Run in Supabase SQL Editor

alter table public.projecten drop constraint if exists projecten_status_check;

alter table public.projecten
  add constraint projecten_status_check
  check (
    status in (
      'schouw_inplannen',
      'schouwweek_gepland',
      'schouwdag_plannen',
      'schouw_gepland',
      'materiaal_inkopen',
      'btw_factuur_eruit',
      'product_ingekocht',
      'installatie_gepland',
      'installatie_voltooid',
      'service'
    )
  );

alter table public.projecten
  add column if not exists leveradres text;

alter table public.projecten
  add column if not exists materiaal_checks jsonb not null default '{}'::jsonb;

comment on column public.projecten.leveradres is
  'Afleveradres voor materiaalinkoop';
comment on column public.projecten.materiaal_checks is
  'JSON map regel_id → boolean (product afgevinkt bij inkopen)';

-- Verantwoordelijke + afdeling op projecten (backoffice-taken)
-- Run in Supabase SQL Editor

alter table public.projecten
  add column if not exists afdeling text,
  add column if not exists verantwoordelijke_id uuid references public.adviseurs(id) on delete set null;

create index if not exists projecten_verantwoordelijke_idx
  on public.projecten (verantwoordelijke_id)
  where verantwoordelijke_id is not null;

create index if not exists projecten_afdeling_idx
  on public.projecten (afdeling)
  where afdeling is not null;

comment on column public.projecten.afdeling is
  'Afdeling verantwoordelijk voor dit project (bijv. Backoffice, Installatie)';
comment on column public.projecten.verantwoordelijke_id is
  'Medewerker die verantwoordelijk is voor dit project';

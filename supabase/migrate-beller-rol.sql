-- Rol "beller" + toewijzing van leads aan bellers
-- Run in Supabase SQL Editor

-- 1) Rol toestaan
alter table public.adviseurs drop constraint if exists adviseurs_rol_check;
alter table public.adviseurs
  add constraint adviseurs_rol_check
  check (rol in ('adviseur', 'backoffice', 'admin', 'installateur', 'beller'));

comment on column public.adviseurs.rol is
  'CRM-rol: adviseur, beller (alleen Bellen-tab), backoffice, admin, installateur';

-- 2) Lead → beller koppeling (apart van sales-adviseur)
alter table public.leads
  add column if not exists beller_id uuid references public.adviseurs(id) on delete set null;

create index if not exists leads_beller_id_idx on public.leads (beller_id);

comment on column public.leads.beller_id is
  'Toegewezen beller (rol=beller); ziet alleen deze leads in Bellen';

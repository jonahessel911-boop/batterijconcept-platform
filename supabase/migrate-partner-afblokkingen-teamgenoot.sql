-- Afblokken per teamgenoot (monteur) i.p.v. alleen per partner.
-- Run in Supabase SQL Editor.

alter table public.partner_afblokkingen
  add column if not exists teamgenoot_id uuid
    references public.installatie_partner_teamgenoten(id) on delete cascade;

comment on column public.partner_afblokkingen.teamgenoot_id is
  'Monteur/teamgenoot; NULL = partner-breed (legacy).';

-- Oude unique (partner, dag, venster) loslaten
alter table public.partner_afblokkingen
  drop constraint if exists partner_afblokkingen_partner_id_dag_venster_key;

-- Per monteur uniek
create unique index if not exists partner_afblokkingen_person_uidx
  on public.partner_afblokkingen (partner_id, dag, venster, teamgenoot_id)
  where teamgenoot_id is not null;

-- Partner-breed uniek (legacy / geen teamgenoten)
create unique index if not exists partner_afblokkingen_partner_uidx
  on public.partner_afblokkingen (partner_id, dag, venster)
  where teamgenoot_id is null;

create index if not exists partner_afblokkingen_teamgenoot_idx
  on public.partner_afblokkingen (teamgenoot_id, dag);

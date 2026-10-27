-- Teamgenoten onder één installatiepartner (monteur-bedrijf)

create table if not exists public.installatie_partner_teamgenoten (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null
    references public.installatie_partners(id) on delete cascade,
  naam        text not null,
  email       text,
  telefoon    text,
  actief      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists installatie_partner_teamgenoten_partner_idx
  on public.installatie_partner_teamgenoten (partner_id, actief);

comment on table public.installatie_partner_teamgenoten is
  'Monteurs/teamgenoten onder één installatiepartner; beheerd via portaal of CRM';

alter table public.installatie_partner_teamgenoten enable row level security;

drop policy if exists "crm_partner_teamgenoten_all" on public.installatie_partner_teamgenoten;
drop policy if exists "crm_partner_teamgenoten_anon" on public.installatie_partner_teamgenoten;
create policy "crm_partner_teamgenoten_all" on public.installatie_partner_teamgenoten
  for all to authenticated using (true) with check (true);
create policy "crm_partner_teamgenoten_anon" on public.installatie_partner_teamgenoten
  for all to anon using (true) with check (true);

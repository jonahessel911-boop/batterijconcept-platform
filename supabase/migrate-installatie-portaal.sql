-- =============================================================================
-- Installatieportaal: partners, schouw-planning, projectfoto's
-- Run in Supabase SQL Editor
-- =============================================================================

-- Installatiepartners (externe monteurs / partners)
create table if not exists public.installatie_partners (
  id              uuid primary key default gen_random_uuid(),
  naam            text not null,
  email           text not null,
  telefoon        text,
  actief          boolean not null default true,
  portal_token    text unique not null default encode(gen_random_bytes(24), 'hex'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists installatie_partners_email_idx
  on public.installatie_partners (email);
create index if not exists installatie_partners_portal_token_idx
  on public.installatie_partners (portal_token);

drop trigger if exists installatie_partners_set_updated_at on public.installatie_partners;
create trigger installatie_partners_set_updated_at
  before update on public.installatie_partners
  for each row execute function public.set_updated_at();

alter table public.installatie_partners enable row level security;

drop policy if exists "crm_installatie_partners_all" on public.installatie_partners;
drop policy if exists "crm_installatie_partners_anon" on public.installatie_partners;
create policy "crm_installatie_partners_all" on public.installatie_partners
  for all to authenticated using (true) with check (true);
create policy "crm_installatie_partners_anon" on public.installatie_partners
  for all to anon using (true) with check (true);

-- Project: schouw + partner-koppeling
alter table public.projecten
  add column if not exists schouw_at timestamptz,
  add column if not exists schouw_notities text,
  add column if not exists installatie_partner_id uuid
    references public.installatie_partners(id) on delete set null,
  add column if not exists schouw_mail_klant_verstuurd boolean not null default false,
  add column if not exists schouw_mail_partner_verstuurd boolean not null default false;

create index if not exists projecten_installatie_partner_id_idx
  on public.projecten (installatie_partner_id);
create index if not exists projecten_schouw_at_idx
  on public.projecten (schouw_at);

-- Status: schouw_gepland toevoegen
alter table public.projecten drop constraint if exists projecten_status_check;

alter table public.projecten
  add constraint projecten_status_check
  check (
    status in (
      'schouw_inplannen',
      'schouw_gepland',
      'btw_factuur_eruit',
      'product_ingekocht',
      'installatie_gepland',
      'installatie_voltooid',
      'service'
    )
  );

-- Projectfoto's (metadata; bestanden in storage bucket project-fotos)
create table if not exists public.project_fotos (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projecten(id) on delete cascade,
  storage_path    text not null,
  bestandsnaam    text,
  omschrijving    text,
  created_at      timestamptz not null default now()
);

create index if not exists project_fotos_project_id_idx
  on public.project_fotos (project_id);

alter table public.project_fotos enable row level security;

drop policy if exists "crm_project_fotos_all" on public.project_fotos;
drop policy if exists "crm_project_fotos_anon" on public.project_fotos;
create policy "crm_project_fotos_all" on public.project_fotos
  for all to authenticated using (true) with check (true);
create policy "crm_project_fotos_anon" on public.project_fotos
  for all to anon using (true) with check (true);

comment on table public.installatie_partners is
  'Externe installatiepartners met toegang tot het installatieportaal';
comment on column public.projecten.schouw_at is
  'Geplande schouwdatum/-tijd (Europe/Amsterdam weergave in mails)';
comment on column public.projecten.installatie_partner_id is
  'Gekoppelde installatiepartner voor dit project (order)';

-- Storage bucket (run once; ignore error if exists)
insert into storage.buckets (id, name, public)
values ('project-fotos', 'project-fotos', false)
on conflict (id) do nothing;

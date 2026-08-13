-- Service verzoeken (gekoppeld aan projecten)
-- Run in Supabase SQL Editor

create table if not exists public.service_verzoeken (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projecten(id) on delete cascade,
  lead_id           uuid not null references public.leads(id) on delete cascade,
  onderwerp         text not null,
  omschrijving      text,
  status            text not null default 'open'
                      check (status in ('open', 'afgehandeld')),
  interne_notitie   text,
  afgehandeld_op    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists service_verzoeken_project_id_idx
  on public.service_verzoeken (project_id);
create index if not exists service_verzoeken_lead_id_idx
  on public.service_verzoeken (lead_id);
create index if not exists service_verzoeken_status_idx
  on public.service_verzoeken (status);
create index if not exists service_verzoeken_created_at_idx
  on public.service_verzoeken (created_at desc);

drop trigger if exists service_verzoeken_set_updated_at on public.service_verzoeken;
create trigger service_verzoeken_set_updated_at
  before update on public.service_verzoeken
  for each row execute function public.set_updated_at();

alter table public.service_verzoeken enable row level security;

drop policy if exists "crm_service_verzoeken_all" on public.service_verzoeken;
drop policy if exists "crm_service_verzoeken_anon" on public.service_verzoeken;

create policy "crm_service_verzoeken_all" on public.service_verzoeken
  for all to authenticated using (true) with check (true);
create policy "crm_service_verzoeken_anon" on public.service_verzoeken
  for all to anon using (true) with check (true);

comment on table public.service_verzoeken is
  'Serviceverzoeken op projecten; open → projectstatus Service, afgehandeld → Installatie voltooid';

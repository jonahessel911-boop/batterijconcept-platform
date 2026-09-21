-- Interne recruitment-agenda (geen e-mail naar kandidaat)

create table if not exists public.sollicitatie_afspraken (
  id uuid primary key default gen_random_uuid(),
  sollicitatie_id uuid not null references public.sollicitaties(id) on delete cascade,
  start_at timestamptz not null,
  soort text not null default 'telefonisch'
    check (soort in ('fysiek', 'telefonisch')),
  notitie text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sollicitatie_afspraken_start
  on public.sollicitatie_afspraken(start_at);

create index if not exists idx_sollicitatie_afspraken_sollicitatie
  on public.sollicitatie_afspraken(sollicitatie_id);

alter table public.sollicitatie_afspraken enable row level security;

drop policy if exists "crm_sollicitatie_afspraken_all" on public.sollicitatie_afspraken;
create policy "crm_sollicitatie_afspraken_all" on public.sollicitatie_afspraken
  for all using (true) with check (true);

-- Recruitment trainingmomenten (multi-dag) + koppeling op sollicitatie

create table if not exists public.training_momenten (
  id uuid primary key default gen_random_uuid(),
  naam text not null,
  periode_van date not null,
  periode_tot date not null,
  adres text not null default 'Daltonlaan 500, 3584 BK Utrecht',
  inhoud text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (periode_tot >= periode_van)
);

create table if not exists public.training_moment_dagen (
  id uuid primary key default gen_random_uuid(),
  training_moment_id uuid not null
    references public.training_momenten(id) on delete cascade,
  dag_nummer int not null check (dag_nummer >= 1),
  datum date not null,
  start_tijd time not null,
  eind_tijd time not null,
  planning text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (training_moment_id, dag_nummer)
);

create index if not exists idx_training_moment_dagen_moment
  on public.training_moment_dagen(training_moment_id, dag_nummer);

alter table public.sollicitaties
  add column if not exists training_moment_id uuid
    references public.training_momenten(id) on delete set null;

create index if not exists idx_sollicitaties_training_moment
  on public.sollicitaties(training_moment_id)
  where training_moment_id is not null;

alter table public.training_momenten enable row level security;
alter table public.training_moment_dagen enable row level security;

drop policy if exists "crm_training_momenten_all" on public.training_momenten;
create policy "crm_training_momenten_all" on public.training_momenten
  for all using (true) with check (true);

drop policy if exists "crm_training_moment_dagen_all" on public.training_moment_dagen;
create policy "crm_training_moment_dagen_all" on public.training_moment_dagen
  for all using (true) with check (true);

comment on table public.training_momenten is
  'Recruitment trainingmomenten (periode + inhoud); dagen in training_moment_dagen';

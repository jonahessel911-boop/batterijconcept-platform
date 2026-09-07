-- Taken per project (niet op projectniveau toewijzen)
-- Run in Supabase SQL Editor

create table if not exists public.project_taken (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projecten(id) on delete cascade,
  titel text not null,
  status text not null default 'todo'
    check (status in ('todo', 'doing', 'done')),
  afdeling text not null,
  verantwoordelijke_id uuid references public.adviseurs(id) on delete set null,
  due_at timestamptz,
  /** Sleutel voor auto-taken (uniek per project) — null = handmatig */
  auto_key text,
  notities text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists project_taken_auto_key_uidx
  on public.project_taken (project_id, auto_key)
  where auto_key is not null;

create index if not exists project_taken_project_idx
  on public.project_taken (project_id);

create index if not exists project_taken_open_idx
  on public.project_taken (status, due_at)
  where status <> 'done';

create index if not exists project_taken_afdeling_idx
  on public.project_taken (afdeling);

comment on table public.project_taken is
  'Backoffice-taken gekoppeld aan een project; afdeling + persoon + due date';

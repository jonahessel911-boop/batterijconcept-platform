-- Persoonlijke admin-agenda: taken + afspraken (CRM-tab Taken, alleen admin).

create table if not exists public.admin_taken (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  inhoud text null,
  soort text not null default 'taak'
    check (soort in ('taak', 'afspraak')),
  due_at timestamptz not null,
  end_at timestamptz null,
  status text not null default 'todo'
    check (status in ('todo', 'done')),
  created_by_id uuid null references public.adviseurs(id) on delete set null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_taken_open_due_idx
  on public.admin_taken (due_at asc)
  where status = 'todo';

create index if not exists admin_taken_status_idx
  on public.admin_taken (status, due_at);

comment on table public.admin_taken is
  'Persoonlijke admin-agenda: taken (deadline) + eigen afspraken (start/eind)';

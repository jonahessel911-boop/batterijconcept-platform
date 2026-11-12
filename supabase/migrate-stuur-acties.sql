-- Persoonlijke stuur-acties (Action Board)
create table if not exists public.stuur_acties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.adviseurs (id) on delete cascade,
  unit text not null,
  row_key text not null,
  row_label text,
  titel text not null,
  notitie text,
  status text not null default 'open'
    check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stuur_acties_owner_status_idx
  on public.stuur_acties (owner_id, status, created_at desc);

create index if not exists stuur_acties_unit_row_idx
  on public.stuur_acties (unit, row_key);

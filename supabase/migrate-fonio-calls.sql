-- Fonio autodialer: lopende / afgeronde outbound-gesprekken
create table if not exists public.fonio_calls (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  to_number text,
  status text not null default 'ringing'
    check (status in ('ringing', 'active', 'done', 'failed', 'timed_out')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  outcome text,
  error text,
  meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fonio_calls_status_started_idx
  on public.fonio_calls (status, started_at desc);

create index if not exists fonio_calls_lead_started_idx
  on public.fonio_calls (lead_id, started_at desc);

comment on table public.fonio_calls is
  'Fonio autodialer concurrency + audit (max N active/ringing tegelijk).';

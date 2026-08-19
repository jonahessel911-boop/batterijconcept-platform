-- Simpel ATS / Instroom

create table if not exists public.sollicitaties (
  id uuid primary key default gen_random_uuid(),
  naam text not null,
  email text null,
  telefoon text null,
  bron text null default 'webhook',
  status text not null default 'nieuw'
    check (status in ('nieuw', 'gescreend', 'gesprek', 'aangenomen', 'afgewezen')),
  notitie text null,
  raw_payload jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sollicitatie_bestanden (
  id uuid primary key default gen_random_uuid(),
  sollicitatie_id uuid not null references public.sollicitaties(id) on delete cascade,
  storage_path text not null,
  bestandsnaam text null,
  mime_type text null,
  grootte_bytes integer null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sollicitaties_created_at
  on public.sollicitaties(created_at desc);

create index if not exists idx_sollicitaties_status
  on public.sollicitaties(status);

create index if not exists idx_sollicitatie_bestanden_sollicitatie_id
  on public.sollicitatie_bestanden(sollicitatie_id);

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'sollicitaties') then
    insert into storage.buckets (id, name, public)
    values ('sollicitaties', 'sollicitaties', false);
  end if;
exception
  when undefined_table then
    null;
end $$;

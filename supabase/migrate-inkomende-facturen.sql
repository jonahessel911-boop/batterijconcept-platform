-- Inkomende facturen / bonnetjes via Postmark inbound e-mail

create table if not exists public.inkomende_facturen (
  id uuid primary key default gen_random_uuid(),
  postmark_message_id text unique,
  from_email text,
  from_name text,
  to_email text,
  subject text,
  body_text text,
  body_html text,
  received_at timestamptz,
  status text not null default 'nieuw'
    check (status in ('nieuw', 'in_behandeling', 'geboekt', 'afgewezen', 'archief')),
  leverancier text,
  bedrag_ex_btw numeric(12, 2),
  btw_bedrag numeric(12, 2),
  bedrag_inc_btw numeric(12, 2),
  factuurdatum date,
  project_id uuid references public.projecten (id) on delete set null,
  notitie text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inkomende_factuur_bestanden (
  id uuid primary key default gen_random_uuid(),
  inkomende_factuur_id uuid not null
    references public.inkomende_facturen (id) on delete cascade,
  storage_path text not null,
  bestandsnaam text null,
  mime_type text null,
  grootte_bytes integer null,
  content_id text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_inkomende_facturen_created_at
  on public.inkomende_facturen (created_at desc);

create index if not exists idx_inkomende_facturen_status
  on public.inkomende_facturen (status);

create index if not exists idx_inkomende_factuur_bestanden_factuur_id
  on public.inkomende_factuur_bestanden (inkomende_factuur_id);

do $$
begin
  if not exists (
    select 1 from storage.buckets where id = 'inkomende-facturen'
  ) then
    insert into storage.buckets (id, name, public)
    values ('inkomende-facturen', 'inkomende-facturen', false);
  end if;
exception
  when undefined_table then
    null;
end $$;

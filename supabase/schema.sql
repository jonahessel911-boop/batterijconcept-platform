-- =============================================================================
-- Batterijconcept.nl CRM — Supabase schema
-- Run dit in de Supabase SQL Editor (of via supabase db push)
-- =============================================================================

-- Extensies
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Helper: updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- LEADS (centrale entiteit — alles hangt aan lead_id)
-- -----------------------------------------------------------------------------
create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  lead_number     text not null unique,           -- bijv. BC-20260813-A1B2
  naam            text not null,
  email           text,
  telefoon        text,
  postcode        text,
  huisnummer      text,
  toevoeging      text,
  straat          text,
  plaats          text,
  -- UTM / bron
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  utm_term        text,
  bron            text default 'website',
  -- CRM status
  status          text not null default 'nieuw'
                    check (status in ('nieuw','contact','offerte','gewonnen','verloren')),
  prioriteit      text not null default 'normaal'
                    check (prioriteit in ('laag','normaal','hoog','urgent')),
  notities        text,
  raw_payload     jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_utm_source_idx on public.leads (utm_source);
create index if not exists leads_email_idx on public.leads (email);

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- PRODUCTEN (catalogus voor offertes)
-- -----------------------------------------------------------------------------
create table if not exists public.producten (
  id              uuid primary key default gen_random_uuid(),
  sku             text unique,
  naam            text not null,
  omschrijving    text,
  prijs_ex_btw    numeric(12,2) not null default 0,
  btw_percentage  numeric(5,2) not null default 21,
  eenheid         text not null default 'stuk',
  actief          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists producten_set_updated_at on public.producten;
create trigger producten_set_updated_at
  before update on public.producten
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- OFFERTES
-- -----------------------------------------------------------------------------
create table if not exists public.offertes (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid not null references public.leads(id) on delete cascade,
  offerte_nummer        text not null unique,     -- bijv. OFF-2026-0001
  status                text not null default 'concept'
                          check (status in ('concept','verzonden','ondertekend','verlopen','afgewezen')),
  titel                 text default 'Offerte thuisbatterij',
  intro_tekst           text,
  -- bedragen
  subtotaal_ex_btw      numeric(12,2) not null default 0,
  btw_bedrag            numeric(12,2) not null default 0,
  totaal_inc_btw        numeric(12,2) not null default 0,
  geldig_tot            date,
  -- online ondertekening
  sign_token            text unique default encode(gen_random_bytes(24), 'hex'),
  ondertekend_naam      text,
  ondertekend_handtekening text,                  -- base64 PNG data URL
  ondertekend_op        timestamptz,
  ondertekend_ip        text,
  waarden_akkoord       boolean default false,
  signed_pdf_path       text,                     -- pad in Supabase Storage
  -- meta
  notities              text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists offertes_lead_id_idx on public.offertes (lead_id);
create index if not exists offertes_status_idx on public.offertes (status);
create index if not exists offertes_sign_token_idx on public.offertes (sign_token);

drop trigger if exists offertes_set_updated_at on public.offertes;
create trigger offertes_set_updated_at
  before update on public.offertes
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- OFFERTE REGELS (regels / geselecteerde producten)
-- -----------------------------------------------------------------------------
create table if not exists public.offerte_regels (
  id              uuid primary key default gen_random_uuid(),
  offerte_id      uuid not null references public.offertes(id) on delete cascade,
  product_id      uuid references public.producten(id) on delete set null,
  omschrijving    text not null,
  aantal          numeric(10,2) not null default 1,
  prijs_ex_btw    numeric(12,2) not null default 0,
  btw_percentage  numeric(5,2) not null default 21,
  totaal_ex_btw   numeric(12,2) generated always as (aantal * prijs_ex_btw) stored,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists offerte_regels_offerte_id_idx on public.offerte_regels (offerte_id);

-- -----------------------------------------------------------------------------
-- PROJECTEN
-- -----------------------------------------------------------------------------
create table if not exists public.projecten (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.leads(id) on delete cascade,
  offerte_id      uuid references public.offertes(id) on delete set null,
  project_nummer  text not null unique,           -- bijv. PRJ-2026-0001
  status          text not null default 'gepland'
                    check (status in ('gepland','in_uitvoering','wacht_op_materiaal','opgeleverd','geannuleerd')),
  titel           text,
  startdatum      date,
  opleverdatum    date,
  monteur         text,
  notities        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists projecten_lead_id_idx on public.projecten (lead_id);
create index if not exists projecten_status_idx on public.projecten (status);

drop trigger if exists projecten_set_updated_at on public.projecten;
create trigger projecten_set_updated_at
  before update on public.projecten
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- FACTUREN
-- -----------------------------------------------------------------------------
create table if not exists public.facturen (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.leads(id) on delete cascade,
  project_id      uuid references public.projecten(id) on delete set null,
  offerte_id      uuid references public.offertes(id) on delete set null,
  factuur_nummer  text not null unique,           -- bijv. FAC-2026-0001
  status          text not null default 'concept'
                    check (status in ('concept','verzonden','betaald','deels_betaald','vervallen')),
  omschrijving    text,
  bedrag_ex_btw   numeric(12,2) not null default 0,
  btw_bedrag      numeric(12,2) not null default 0,
  bedrag_inc_btw  numeric(12,2) not null default 0,
  factuurdatum    date not null default current_date,
  vervaldatum     date,
  betaald_op      date,
  notities        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists facturen_lead_id_idx on public.facturen (lead_id);
create index if not exists facturen_status_idx on public.facturen (status);

drop trigger if exists facturen_set_updated_at on public.facturen;
create trigger facturen_set_updated_at
  before update on public.facturen
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Nummer-generators (lead / offerte / project / factuur)
-- -----------------------------------------------------------------------------
create sequence if not exists public.lead_seq start 1;
create sequence if not exists public.offerte_seq start 1;
create sequence if not exists public.project_seq start 1;
create sequence if not exists public.factuur_seq start 1;

create or replace function public.generate_lead_number()
returns text
language plpgsql
as $$
declare
  seq int;
  suffix text;
begin
  seq := nextval('public.lead_seq');
  suffix := upper(substr(encode(gen_random_bytes(2), 'hex'), 1, 4));
  return 'BC-' || to_char(now() at time zone 'Europe/Amsterdam', 'YYYYMMDD') || '-' || suffix || lpad(seq::text, 3, '0');
end;
$$;

create or replace function public.generate_offerte_nummer()
returns text
language plpgsql
as $$
begin
  return 'OFF-' || to_char(now() at time zone 'Europe/Amsterdam', 'YYYY') || '-' || lpad(nextval('public.offerte_seq')::text, 4, '0');
end;
$$;

create or replace function public.generate_project_nummer()
returns text
language plpgsql
as $$
begin
  return 'PRJ-' || to_char(now() at time zone 'Europe/Amsterdam', 'YYYY') || '-' || lpad(nextval('public.project_seq')::text, 4, '0');
end;
$$;

create or replace function public.generate_factuur_nummer()
returns text
language plpgsql
as $$
begin
  return 'FAC-' || to_char(now() at time zone 'Europe/Amsterdam', 'YYYY') || '-' || lpad(nextval('public.factuur_seq')::text, 4, '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- Storage bucket voor ondertekende PDF's
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('offertes-signed', 'offertes-signed', false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- RLS
-- MVP: anon + authenticated mogen alles (interne CRM zonder login nog).
-- Later: auth aanzetten en anon-policies verwijderen.
-- Policies zijn idempotent (drop + create).
-- -----------------------------------------------------------------------------
alter table public.leads enable row level security;
alter table public.producten enable row level security;
alter table public.offertes enable row level security;
alter table public.offerte_regels enable row level security;
alter table public.projecten enable row level security;
alter table public.facturen enable row level security;

drop policy if exists "crm_leads_all" on public.leads;
drop policy if exists "crm_leads_anon" on public.leads;
drop policy if exists "crm_producten_all" on public.producten;
drop policy if exists "crm_producten_anon" on public.producten;
drop policy if exists "anon_producten_read" on public.producten;
drop policy if exists "crm_offertes_all" on public.offertes;
drop policy if exists "crm_offertes_anon" on public.offertes;
drop policy if exists "crm_offerte_regels_all" on public.offerte_regels;
drop policy if exists "crm_offerte_regels_anon" on public.offerte_regels;
drop policy if exists "crm_projecten_all" on public.projecten;
drop policy if exists "crm_projecten_anon" on public.projecten;
drop policy if exists "crm_facturen_all" on public.facturen;
drop policy if exists "crm_facturen_anon" on public.facturen;
drop policy if exists "signed_pdfs_authenticated_read" on storage.objects;
drop policy if exists "signed_pdfs_service_insert" on storage.objects;
drop policy if exists "signed_pdfs_anon_all" on storage.objects;

create policy "crm_leads_all" on public.leads
  for all to authenticated using (true) with check (true);
create policy "crm_leads_anon" on public.leads
  for all to anon using (true) with check (true);

create policy "crm_producten_all" on public.producten
  for all to authenticated using (true) with check (true);
create policy "crm_producten_anon" on public.producten
  for all to anon using (true) with check (true);

create policy "crm_offertes_all" on public.offertes
  for all to authenticated using (true) with check (true);
create policy "crm_offertes_anon" on public.offertes
  for all to anon using (true) with check (true);

create policy "crm_offerte_regels_all" on public.offerte_regels
  for all to authenticated using (true) with check (true);
create policy "crm_offerte_regels_anon" on public.offerte_regels
  for all to anon using (true) with check (true);

create policy "crm_projecten_all" on public.projecten
  for all to authenticated using (true) with check (true);
create policy "crm_projecten_anon" on public.projecten
  for all to anon using (true) with check (true);

create policy "crm_facturen_all" on public.facturen
  for all to authenticated using (true) with check (true);
create policy "crm_facturen_anon" on public.facturen
  for all to anon using (true) with check (true);

create policy "signed_pdfs_authenticated_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'offertes-signed');

create policy "signed_pdfs_service_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'offertes-signed');

create policy "signed_pdfs_anon_all"
  on storage.objects for all to anon
  using (bucket_id = 'offertes-signed')
  with check (bucket_id = 'offertes-signed');

comment on table public.leads is 'Centrale lead; alle offertes/projecten/facturen verwijzen hiernaar via lead_id';
comment on column public.leads.lead_number is 'Uniek leesbaar ID, gegenereerd bij webhook-intake';
comment on column public.offertes.sign_token is 'Token voor publieke ondertekenpagina /offerte/[token]';

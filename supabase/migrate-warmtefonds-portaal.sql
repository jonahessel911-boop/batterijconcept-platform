-- =============================================================================
-- Warmtefonds-portaal: operators (Edwin e.d.) + notities op project
-- Run in Supabase SQL Editor
-- =============================================================================

create table if not exists public.warmtefonds_operators (
  id              uuid primary key default gen_random_uuid(),
  naam            text not null,
  email           text not null,
  telefoon        text,
  actief          boolean not null default true,
  portal_token    text unique not null default encode(gen_random_bytes(24), 'hex'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists warmtefonds_operators_email_idx
  on public.warmtefonds_operators (email);
create index if not exists warmtefonds_operators_portal_token_idx
  on public.warmtefonds_operators (portal_token);

drop trigger if exists warmtefonds_operators_set_updated_at on public.warmtefonds_operators;
create trigger warmtefonds_operators_set_updated_at
  before update on public.warmtefonds_operators
  for each row execute function public.set_updated_at();

alter table public.warmtefonds_operators enable row level security;

drop policy if exists "crm_warmtefonds_operators_all" on public.warmtefonds_operators;
drop policy if exists "crm_warmtefonds_operators_anon" on public.warmtefonds_operators;
create policy "crm_warmtefonds_operators_all" on public.warmtefonds_operators
  for all to authenticated using (true) with check (true);
create policy "crm_warmtefonds_operators_anon" on public.warmtefonds_operators
  for all to anon using (true) with check (true);

comment on table public.warmtefonds_operators is
  'Externe Warmtefonds-operators (bijv. Edwin) met toegang tot het Warmtefonds-portaal';

-- Notities vanuit het Warmtefonds-portaal (horen bij de klant/order)
alter table public.projecten
  add column if not exists warmtefonds_notities text;

comment on column public.projecten.warmtefonds_notities is
  'Notities van de Warmtefonds-operator bij deze order';

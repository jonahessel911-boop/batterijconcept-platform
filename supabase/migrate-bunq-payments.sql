-- Bunq betalingssync → facturen automatisch op betaald
-- Run in Supabase SQL Editor

alter table public.facturen
  add column if not exists bunq_payment_id bigint;

create unique index if not exists facturen_bunq_payment_id_uidx
  on public.facturen (bunq_payment_id)
  where bunq_payment_id is not null;

comment on column public.facturen.bunq_payment_id is
  'bunq Payment id waarmee deze factuur auto-gematcht is';

create table if not exists public.bunq_payment_log (
  id               uuid primary key default gen_random_uuid(),
  bunq_payment_id  bigint not null unique,
  factuur_id       uuid references public.facturen(id) on delete set null,
  amount           numeric(12,2) not null,
  currency         text not null default 'EUR',
  description      text,
  counterparty     text,
  matched          boolean not null default false,
  raw              jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists bunq_payment_log_factuur_idx
  on public.bunq_payment_log (factuur_id)
  where factuur_id is not null;

create index if not exists bunq_payment_log_matched_idx
  on public.bunq_payment_log (matched);

alter table public.bunq_payment_log enable row level security;

drop policy if exists "crm_bunq_payment_log_all" on public.bunq_payment_log;
drop policy if exists "crm_bunq_payment_log_anon" on public.bunq_payment_log;

create policy "crm_bunq_payment_log_all" on public.bunq_payment_log
  for all to authenticated using (true) with check (true);
create policy "crm_bunq_payment_log_anon" on public.bunq_payment_log
  for all to anon using (true) with check (true);

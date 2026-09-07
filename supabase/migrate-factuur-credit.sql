-- Creditfactuur gekoppeld aan eerdere klantfactuur
-- Run in Supabase SQL Editor

alter table public.facturen
  add column if not exists credit_van_factuur_id uuid
    references public.facturen(id) on delete set null;

create index if not exists facturen_credit_van_idx
  on public.facturen (credit_van_factuur_id)
  where credit_van_factuur_id is not null;

comment on column public.facturen.credit_van_factuur_id is
  'Als gezet: dit is een creditfactuur bij de genoemde oorspronkelijke factuur';

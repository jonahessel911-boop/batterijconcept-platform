-- Financieringsvoorbehoud Warmtefonds op offertes
alter table public.offertes
  add column if not exists financiering_voorbehoud boolean not null default false;

-- Soft claim voor gelijktijdig bellen: 1 lead = 1 beller.
-- Run in Supabase SQL Editor

alter table public.leads
  add column if not exists bel_claimed_by uuid references public.adviseurs(id) on delete set null,
  add column if not exists bel_claimed_at timestamptz;

create index if not exists leads_bel_claimed_by_idx
  on public.leads (bel_claimed_by)
  where bel_claimed_by is not null;

create index if not exists leads_bel_claimed_at_idx
  on public.leads (bel_claimed_at)
  where bel_claimed_at is not null;

comment on column public.leads.bel_claimed_by is
  'Medewerker die deze lead nu in de Bel-tab heeft (soft lock).';
comment on column public.leads.bel_claimed_at is
  'Moment van claim / laatste heartbeat. Verloopt na ~15 min zonder heartbeat.';

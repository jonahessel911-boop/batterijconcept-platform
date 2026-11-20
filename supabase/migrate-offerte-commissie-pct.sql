-- Per-order commissie-% (null = adviseur-standaard, 0 = geen commissie)
-- Run in Supabase SQL Editor

alter table public.offertes
  add column if not exists commissie_pct numeric(5,2);

comment on column public.offertes.commissie_pct is
  'Override commissie-% voor deze order. Null = adviseur.commissie_pct. 0 = geen commissie.';

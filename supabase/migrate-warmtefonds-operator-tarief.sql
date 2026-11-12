-- =============================================================================
-- Per Warmtefonds-operator: eigen vergoeding per aanvraag (incl. btw)
-- Null = val terug op globaal Edergy-tarief (default €375)
-- Run in Supabase SQL Editor
-- =============================================================================

alter table public.warmtefonds_operators
  add column if not exists tarief_inc numeric(12, 2);

comment on column public.warmtefonds_operators.tarief_inc is
  'Vergoeding per Warmtefonds-aanvraag incl. btw voor deze operator. Null = globaal Edergy-tarief.';

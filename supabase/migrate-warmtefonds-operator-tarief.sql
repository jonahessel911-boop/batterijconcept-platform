-- =============================================================================
-- Per Warmtefonds-operator: eigen vergoeding per aanvraag (incl. btw)
-- Null = standaardtarief (€150). Run in Supabase SQL Editor.
-- =============================================================================

alter table public.warmtefonds_operators
  add column if not exists tarief_inc numeric(12, 2);

comment on column public.warmtefonds_operators.tarief_inc is
  'Vergoeding per Warmtefonds-aanvraag incl. btw voor deze operator. Null = standaard €150.';

-- Edwin (Edergy) behoudt historisch €375 als eigen tarief
update public.warmtefonds_operators
set tarief_inc = 375
where naam ilike '%Edwin%'
  and (tarief_inc is null or tarief_inc <= 0);

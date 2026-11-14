-- =============================================================================
-- Warmtefonds-adviseurs: account (wachtwoord) + tarief per persoon
-- Run in Supabase SQL Editor
-- =============================================================================

alter table public.warmtefonds_operators
  add column if not exists tarief_inc numeric(12, 2);

alter table public.warmtefonds_operators
  add column if not exists password_hash text;

comment on column public.warmtefonds_operators.tarief_inc is
  'Vergoeding per WF-aanvraag incl. btw. Null = standaard €150.';

comment on column public.warmtefonds_operators.password_hash is
  'Wachtwoord-hash voor /warmtefonds/login. Null = nog geen account / invite sturen.';

-- Edwin (Edergy) behoudt historisch €375
update public.warmtefonds_operators
set tarief_inc = 375
where naam ilike '%Edwin%'
  and (tarief_inc is null or tarief_inc <= 0);

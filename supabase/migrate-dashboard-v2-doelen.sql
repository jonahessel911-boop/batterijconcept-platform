-- Dashboard v2 / Admin targets (JSONB)
-- Run in Supabase SQL Editor
--
-- Bevat team-doelen + standaard per rol + overrides per medewerker/partner.
-- Geschreven door Admin-tab (`/?tab=admin`).

alter table public.dashboard_instellingen
  add column if not exists dashboard_v2_doelen jsonb not null default '{}'::jsonb;

comment on column public.dashboard_instellingen.dashboard_v2_doelen is
  'Admin targets: { version:1, defaults:{team,adviseur,beller,installateur}, personen, partners, per_7_days }';

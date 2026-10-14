-- Sales Manager: conversiedoelen per adviseur per maand (yyyy-MM → { adviseurId: pct })
-- Run in Supabase SQL Editor

alter table public.dashboard_instellingen
  add column if not exists sales_manager_doelen jsonb not null default '{}'::jsonb;

comment on column public.dashboard_instellingen.sales_manager_doelen is
  'Conversiedoelen Sales Manager: { "2026-10": { "<adviseur_id>": 25 } }';

-- Weekmeeting: weekdoelen + aandachtspunten per adviseur (ISO-week yyyy-Www).
-- Run in Supabase SQL Editor.

alter table public.dashboard_instellingen
  add column if not exists weekmeeting_doelen jsonb not null default '{}'::jsonb;

comment on column public.dashboard_instellingen.weekmeeting_doelen is
  'Weekmeeting: { "2026-W42": { "<adviseur_id>": { "target": 8, "aandachtspunten": "…" } } }';

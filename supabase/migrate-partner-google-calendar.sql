-- Google Calendar koppeling per installatiepartner (OAuth + directe event-push)
-- Run in Supabase SQL Editor

alter table public.installatie_partners
  add column if not exists google_refresh_token text,
  add column if not exists google_access_token text,
  add column if not exists google_token_expires_at timestamptz,
  add column if not exists google_calendar_id text not null default 'primary',
  add column if not exists google_connected_email text,
  add column if not exists google_connected_at timestamptz;

comment on column public.installatie_partners.google_refresh_token is
  'OAuth refresh token voor Calendar API (geheim, niet in API responses)';

alter table public.projecten
  add column if not exists schouw_gcal_event_id text,
  add column if not exists installatie_gcal_event_id text,
  add column if not exists service_gcal_event_id text;

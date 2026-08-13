-- Wachtwoord-hash voor teamlogin
-- Run in Supabase SQL Editor

alter table public.adviseurs
  add column if not exists password_hash text;

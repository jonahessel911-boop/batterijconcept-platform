-- Startdatum adviseur: agenda geblokkeerd tot (niet inclusief) deze dag
-- Run in Supabase SQL Editor

alter table public.adviseurs
  add column if not exists startdatum date null;

comment on column public.adviseurs.startdatum is
  'Eerste werkdag; slots vóór deze datum worden automatisch afgeblokt';

-- Harald, Stijn, Jorrit, Winny, Marcel → start maandag 19 oktober 2026
update public.adviseurs
set startdatum = '2026-10-19'
where id in (
  '48ad1b2c-9881-450b-a44e-96ebe81777f4', -- Harald
  'be4e799b-16e8-4914-9bcf-ee633e7c3519', -- Stijn
  'baba39cf-6d25-4e8d-8030-d537d838a431', -- Jorrit
  'a0bbca2e-43b1-447e-96c0-f14b8fd8f247', -- Winny Bogers
  '1925468e-5645-44a0-a6fc-962b95d0f46c'  -- Marcel Klaasman
);

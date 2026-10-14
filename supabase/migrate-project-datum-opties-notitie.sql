-- Additive: service_notitie op bestaande-opties (als migrate-project-datum-opties.sql al eerder is gedraaid).
-- Run in Supabase SQL Editor.

alter table public.project_datum_opties
  add column if not exists service_notitie text null;

comment on column public.project_datum_opties.service_notitie is
  'Notitie voor installateur / serviceverzoek (bij soort=service).';

-- Interne notitie op factuur (CRM only — niet op PDF)
-- Run in Supabase SQL Editor

alter table public.facturen
  add column if not exists interne_notitie text;

comment on column public.facturen.interne_notitie is
  'Interne BO/sales-notitie bij de factuur; niet zichtbaar op de klant-PDF';

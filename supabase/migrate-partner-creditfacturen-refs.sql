-- Offerte- en projectnummer op partner-creditfacturen
alter table public.partner_creditfacturen
  add column if not exists offerte_nummer text,
  add column if not exists project_nummer text;

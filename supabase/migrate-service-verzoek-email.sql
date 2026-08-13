-- Optioneel: sla inkomend e-mailadres op bij serviceverzoek
-- Run in Supabase SQL Editor (ná migrate-service-verzoeken.sql)

alter table public.service_verzoeken
  add column if not exists klant_email text;

create index if not exists service_verzoeken_klant_email_idx
  on public.service_verzoeken (klant_email);

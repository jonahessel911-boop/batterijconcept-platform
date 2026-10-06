-- Relatiegegevens + ondertekend samenwerkingscontract
-- Adviseurs: contract-kolommen
-- Installatiepartners: KvK/bedrijfsgegevens + contract

alter table public.adviseurs
  add column if not exists contract_storage_path text,
  add column if not exists contract_bestandsnaam text,
  add column if not exists contract_uploaded_at timestamptz;

comment on column public.adviseurs.contract_storage_path is
  'Storage-pad van ondertekend samenwerkingscontract (bucket relatie-contracten).';

alter table public.installatie_partners
  add column if not exists bedrijfsnaam text,
  add column if not exists kvk_nummer text,
  add column if not exists btw_nummer text,
  add column if not exists factuur_adres text,
  add column if not exists factuur_postcode text,
  add column if not exists factuur_plaats text,
  add column if not exists iban text,
  add column if not exists contract_storage_path text,
  add column if not exists contract_bestandsnaam text,
  add column if not exists contract_uploaded_at timestamptz;

-- Storage bucket (run via Supabase dashboard of storage API indien nodig)
-- insert into storage.buckets (id, name, public)
-- values ('relatie-contracten', 'relatie-contracten', false)
-- on conflict (id) do nothing;

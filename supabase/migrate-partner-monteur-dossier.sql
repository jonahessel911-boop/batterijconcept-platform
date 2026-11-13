-- Monteur-dossier onder installatie_partner_teamgenoten:
-- verplicht: KvK-uittreksel, certificaten, foto; optioneel: CV.

alter table public.installatie_partner_teamgenoten
  add column if not exists kvk_uitreksel_storage_path text,
  add column if not exists kvk_uitreksel_bestandsnaam text,
  add column if not exists kvk_uitreksel_uploaded_at timestamptz,
  add column if not exists certificaten_storage_path text,
  add column if not exists certificaten_bestandsnaam text,
  add column if not exists certificaten_uploaded_at timestamptz,
  add column if not exists cv_storage_path text,
  add column if not exists cv_bestandsnaam text,
  add column if not exists cv_uploaded_at timestamptz,
  add column if not exists foto_storage_path text,
  add column if not exists foto_bestandsnaam text,
  add column if not exists foto_uploaded_at timestamptz,
  add column if not exists dossier_compleet boolean not null default false;

create index if not exists installatie_partner_teamgenoten_dossier_idx
  on public.installatie_partner_teamgenoten (partner_id, dossier_compleet)
  where actief = true;

comment on column public.installatie_partner_teamgenoten.dossier_compleet is
  'True als KvK + certificaten + foto aanwezig zijn; vereist voor inplannen';

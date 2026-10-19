-- Onboarding-documenten + activiteitentijdlijn voor adviseurs en monteurs.

alter table public.adviseurs
  add column if not exists kvk_uitreksel_storage_path text,
  add column if not exists kvk_uitreksel_bestandsnaam text,
  add column if not exists kvk_uitreksel_uploaded_at timestamptz;

alter table public.installatie_partners
  add column if not exists kvk_uitreksel_storage_path text,
  add column if not exists kvk_uitreksel_bestandsnaam text,
  add column if not exists kvk_uitreksel_uploaded_at timestamptz,
  add column if not exists certificaten_storage_path text,
  add column if not exists certificaten_bestandsnaam text,
  add column if not exists certificaten_uploaded_at timestamptz;

create table if not exists public.relatie_activiteit (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('adviseur', 'partner')),
  relatie_id uuid not null,
  soort text not null,
  titel text not null,
  detail text,
  created_at timestamptz not null default now(),
  created_by uuid references public.adviseurs (id) on delete set null
);

create index if not exists relatie_activiteit_relatie_idx
  on public.relatie_activiteit (kind, relatie_id, created_at desc);

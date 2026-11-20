-- Installatie-afspraak hangt aan een koppel (2 monteurs).
-- Schouw blijft op installatie_teamgenoot_id (persoon met kan_schouw).

alter table public.projecten
  add column if not exists installatie_koppel_id uuid
    references public.installatie_partner_koppels (id) on delete set null;

create index if not exists projecten_installatie_koppel_idx
  on public.projecten (installatie_koppel_id);

comment on column public.projecten.installatie_koppel_id is
  'Koppel dat de installatie uitvoert. Schouw-medewerker staat op installatie_teamgenoot_id.';

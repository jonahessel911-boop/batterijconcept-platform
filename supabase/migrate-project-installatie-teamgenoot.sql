-- Monteur/teamgenoot gekoppeld aan een project (na partner-keuze door BO).
-- Partner koppelt zelf via portaal wie de klus doet.

alter table public.projecten
  add column if not exists installatie_teamgenoot_id uuid
    references public.installatie_partner_teamgenoten(id) on delete set null;

create index if not exists projecten_installatie_teamgenoot_id_idx
  on public.projecten (installatie_teamgenoot_id);

comment on column public.projecten.installatie_teamgenoot_id is
  'Monteur van de installatiepartner die dit project uitvoert; partner koppelt via portaal.';

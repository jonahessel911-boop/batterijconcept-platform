-- Service-inzet op teamgenoot + service-afspraak hangt aan die persoon.
-- Opleverformulier kan een vervolg boeken als "Service - VV Installatie".

alter table public.installatie_partner_teamgenoten
  add column if not exists kan_service boolean default false;

update public.installatie_partner_teamgenoten
set kan_service = coalesce(kan_service, false)
where kan_service is null;

comment on column public.installatie_partner_teamgenoten.kan_service is
  'Mag service / nazorg (o.a. Service - VV Installatie na oplevering).';

alter table public.projecten
  add column if not exists service_teamgenoot_id uuid
    references public.installatie_partner_teamgenoten (id) on delete set null;

create index if not exists projecten_service_teamgenoot_idx
  on public.projecten (service_teamgenoot_id);

comment on column public.projecten.service_teamgenoot_id is
  'Monteur (kan_service) voor de service-afspraak. Schouw blijft op installatie_teamgenoot_id.';

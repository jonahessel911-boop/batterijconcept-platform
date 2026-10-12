-- Wie heeft de offerte aangemaakt (adviseur ziet alleen eigen offertes)
alter table public.offertes
  add column if not exists aangemaakt_door_id uuid
    references public.adviseurs(id) on delete set null;

create index if not exists offertes_aangemaakt_door_idx
  on public.offertes (aangemaakt_door_id)
  where aangemaakt_door_id is not null;

comment on column public.offertes.aangemaakt_door_id is
  'Adviseur die de offerte heeft aangemaakt.';

-- Backfill: lead-eigenaar als maker waar nog leeg
update public.offertes o
set aangemaakt_door_id = l.adviseur_id
from public.leads l
where o.lead_id = l.id
  and o.aangemaakt_door_id is null
  and l.adviseur_id is not null;

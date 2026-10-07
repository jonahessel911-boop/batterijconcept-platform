-- Moment waarop installatie als uitgevoerd is gemarkeerd (netto sale).

alter table public.projecten
  add column if not exists installatie_voltooid_at timestamptz null;

comment on column public.projecten.installatie_voltooid_at is
  'Moment waarop status installatie_voltooid werd gezet (netto sale)';

-- Bestaande voltooide projecten: éénmalig terugvullen (geen hernieuwde celebrate)
update public.projecten
set installatie_voltooid_at = coalesce(
  installatie_voltooid_at,
  installatie_at,
  updated_at,
  created_at
)
where installatie_voltooid_at is null
  and status in ('installatie_voltooid', 'review_gevraagd', 'service');

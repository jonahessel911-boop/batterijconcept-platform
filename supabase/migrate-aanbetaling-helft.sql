-- Eigen middelen: 50% vooraf / 50% na installatie
alter table public.offertes
  drop constraint if exists offertes_aanbetaling_modus_check;

alter table public.offertes
  add constraint offertes_aanbetaling_modus_check
  check (aanbetaling_modus in ('restant', 'btw', 'handmatig', 'helft'));

comment on column public.offertes.aanbetaling_modus is
  'Warmtefonds: restant / btw / handmatig. Eigen middelen: helft (50% vooraf, 50% na installatie).';

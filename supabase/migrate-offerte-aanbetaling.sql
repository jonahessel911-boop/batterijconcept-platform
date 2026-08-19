-- Aanbetaling bij Warmtefonds: restant €8500, btw-bedrag of handmatig
alter table public.offertes
  add column if not exists aanbetaling_modus text not null default 'restant';

alter table public.offertes
  add column if not exists aanbetaling_bedrag_inc numeric;

alter table public.offertes
  drop constraint if exists offertes_aanbetaling_modus_check;

alter table public.offertes
  add constraint offertes_aanbetaling_modus_check
  check (aanbetaling_modus in ('restant', 'btw', 'handmatig'));

comment on column public.offertes.aanbetaling_modus is
  'Warmtefonds-aanbetaling: restant (totaal−8500), btw (btw-bedrag) of handmatig.';

comment on column public.offertes.aanbetaling_bedrag_inc is
  'Handmatig aanbetalingsbedrag incl. btw (alleen bij modus handmatig).';

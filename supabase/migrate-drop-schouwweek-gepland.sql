-- Verwijder status schouwweek_gepland → aanbetaling_verstuurd
-- (schouwweek zelf blijft data via schouw_jaar / schouw_week)
begin;

alter table public.projecten drop constraint if exists projecten_status_check;

update public.projecten
set status = 'aanbetaling_verstuurd'
where status = 'schouwweek_gepland';

alter table public.projecten
  add constraint projecten_status_check
  check (
    status in (
      'schouwweek_inplannen',
      'aanbetaling_verstuurd',
      'aanbetaling_betaald',
      'warmtefonds_aangevraagd',
      'warmtefonds_in_behandeling',
      'warmtefonds_afgewezen',
      'warmtefonds_goedgekeurd',
      'schouwdag_ingepland',
      'schouw_voltooid',
      'restfactuur_verstuurd',
      'restfactuur_betaald',
      'materiaal_besteld',
      'installatie_ingepland',
      'installatie_voltooid',
      'review_gevraagd',
      'service',
      'annulering',
      'hold_sales_actie'
    )
  );

commit;

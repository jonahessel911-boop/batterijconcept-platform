-- WF: na opstarten → "Opstarten voltooid — afwachten WF"
-- "Schouw gepland" alleen bij echte schouwdag (niet week-placeholder)

begin;

alter table public.projecten drop constraint if exists projecten_status_check;

alter table public.projecten
  add constraint projecten_status_check
  check (
    status in (
      'schouwweek_inplannen',
      'aanbetaling_verstuurd',
      'aanbetaling_betaald',
      'warmtefonds_afspraak_ingepland',
      'warmtefonds_aangevraagd',
      'warmtefonds_in_behandeling',
      'warmtefonds_afgewezen',
      'warmtefonds_goedgekeurd',
      'opstarten_voltooid_afwachten_wf',
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

-- Backfill: WF-projecten met status schouwdag_ingepland maar alleen week-placeholder
-- (schouw_at = maandag 12:00 Amsterdam van die schouwweek)
update public.projecten p
set status = 'opstarten_voltooid_afwachten_wf',
    updated_at = now()
where p.status = 'schouwdag_ingepland'
  and p.schouw_at is not null
  and p.schouw_jaar is not null
  and p.schouw_week is not null
  and extract(isodow from (p.schouw_at at time zone 'Europe/Amsterdam')) = 1
  and extract(hour from (p.schouw_at at time zone 'Europe/Amsterdam')) = 12
  and extract(minute from (p.schouw_at at time zone 'Europe/Amsterdam')) = 0
  and exists (
    select 1
    from public.offertes o
    where o.id = p.offerte_id
      and o.financiering_voorbehoud is true
  );

comment on column public.projecten.status is
  'Orderstatus; opstarten_voltooid_afwachten_wf = WF na kickoff, wacht op Warmtefonds (schouwweek staat, nog geen echte schouwdag)';

commit;

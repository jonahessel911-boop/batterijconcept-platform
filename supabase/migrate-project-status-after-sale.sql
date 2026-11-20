-- After sale: overstap / BTW / review ná oplevering.
-- review_gevraagd blijft toegestaan (legacy alias).

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
      'after_sale',
      'review_gevraagd',
      'afgerond',
      'service',
      'annulering',
      'hold_sales_actie'
    )
  );

comment on column public.projecten.status is
  'Orderpipeline; after_sale = ná installatie (overstap, BTW, review); afgerond = checklist klaar.';

commit;

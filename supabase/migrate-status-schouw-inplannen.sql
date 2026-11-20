-- Orderstatus "Schouw inplannen": WF-goedkeuring (aanbod ondertekenen)
-- → BO plant de exacte schouwdag. Was tot nu toe alleen een afgeleide Actie.

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
        'schouw_inplannen',
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

-- Bestaande WF-goedgekeurde orders zonder echte schouwdag
update public.projecten p
set status = 'schouw_inplannen',
    updated_at = now()
where p.status in (
    'opstarten_voltooid_afwachten_wf',
    'schouwweek_inplannen',
    'warmtefonds_goedgekeurd'
  )
  and p.financiering_status in (
    'aanbod_ondertekenen',
    'aanvraag_goedgekeurd',
    'declaratie_indienen',
    'wacht_op_betaling',
    'uitbetaald'
  )
  and (
    p.schouw_at is null
    or (
      p.schouw_jaar is not null
      and p.schouw_week is not null
      and extract(isodow from (p.schouw_at at time zone 'Europe/Amsterdam')) = 1
      and extract(hour from (p.schouw_at at time zone 'Europe/Amsterdam')) = 12
      and extract(minute from (p.schouw_at at time zone 'Europe/Amsterdam')) = 0
    )
  );

comment on column public.projecten.status is
  'Orderpipeline; schouw_inplannen = WF goedgekeurd (aanbod ondertekenen), exacte schouwdag nog plannen.';

commit;

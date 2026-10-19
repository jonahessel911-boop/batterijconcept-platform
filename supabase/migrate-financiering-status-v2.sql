-- Warmtefonds pipeline v2: 7 stappen + afgewezen
-- Run in Supabase SQL Editor

alter table public.projecten drop constraint if exists projecten_financiering_status_check;

alter table public.projecten
  add constraint projecten_financiering_status_check
  check (
    financiering_status is null
    or financiering_status in (
      -- pipeline v2
      'doorgestuurd_naar_edwin',
      'documenten_aanleveren',
      'in_behandeling',
      'aanbod_ondertekenen',
      'declaratie_indienen',
      'wacht_op_betaling',
      'uitbetaald',
      'afgewezen',
      -- legacy (blijft leesbaar tot backfill)
      'afspraak_ingepland',
      'aanvraag_gedaan',
      'aanvraag_goedgekeurd'
    )
  );

-- Soft backfill legacy → v2 (afspraak_ingepland blijft; afspraak is intern veld)
update public.projecten
set financiering_status = 'in_behandeling'
where financiering_status = 'aanvraag_gedaan';

update public.projecten
set financiering_status = 'aanbod_ondertekenen'
where financiering_status = 'aanvraag_goedgekeurd';

comment on column public.projecten.financiering_status is
  'WF pipeline: doorgestuurd → documenten → in_behandeling → aanbod → declaratie → wacht_op_betaling → uitbetaald';

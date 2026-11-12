-- WF-stap: Contact verstuurd (tussen doorgestuurd/documenten en in behandeling).
-- Run in Supabase SQL Editor

alter table public.projecten drop constraint if exists projecten_financiering_status_check;

alter table public.projecten
  add constraint projecten_financiering_status_check
  check (
    financiering_status is null
    or financiering_status in (
      'doorgestuurd_naar_edwin',
      'documenten_aanleveren',
      'contact_verstuurd',
      'in_behandeling',
      'aanbod_ondertekenen',
      'declaratie_indienen',
      'wacht_op_betaling',
      'uitbetaald',
      'afgewezen',
      -- legacy
      'afspraak_ingepland',
      'aanvraag_gedaan',
      'aanvraag_goedgekeurd'
    )
  );

comment on column public.projecten.financiering_status is
  'WF pipeline: doorgestuurd → documenten → contact_verstuurd → in_behandeling → aanbod → declaratie → wacht_op_betaling → uitbetaald';

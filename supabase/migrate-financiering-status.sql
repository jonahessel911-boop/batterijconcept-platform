-- Aparte financieringsfase (Warmtefonds), parallel aan project.status
-- 1 doorgestuurd_naar_edwin → 2 afspraak_ingepland → aanvraag → goedgekeurd → uitbetaald

alter table public.projecten
  add column if not exists financiering_status text null;

alter table public.projecten
  add column if not exists warmtefonds_afspraak_at timestamptz null;

alter table public.projecten drop constraint if exists projecten_financiering_status_check;

alter table public.projecten
  add constraint projecten_financiering_status_check
  check (
    financiering_status is null
    or financiering_status in (
      'doorgestuurd_naar_edwin',
      'afspraak_ingepland',
      'aanvraag_gedaan',
      'aanvraag_goedgekeurd',
      'uitbetaald',
      'afgewezen'
    )
  );

comment on column public.projecten.financiering_status is
  'Warmtefonds-fase: doorgestuurd_naar_edwin → afspraak_ingepland → aanvraag_gedaan → aanvraag_goedgekeurd → uitbetaald';

comment on column public.projecten.warmtefonds_afspraak_at is
  'Interne datum/tijd Warmtefonds-afspraak (geen mail) — gezet bij status afspraak_ingepland';

-- Backfill financiering_status vanuit oude hoofdstatus
update public.projecten
set financiering_status = case status
  when 'warmtefonds_afspraak_ingepland' then 'afspraak_ingepland'
  when 'warmtefonds_aangevraagd' then 'aanvraag_gedaan'
  when 'warmtefonds_in_behandeling' then 'aanvraag_gedaan'
  when 'warmtefonds_goedgekeurd' then 'aanvraag_goedgekeurd'
  when 'warmtefonds_afgewezen' then 'afgewezen'
  else financiering_status
end
where financiering_status is null
  and status in (
    'warmtefonds_afspraak_ingepland',
    'warmtefonds_aangevraagd',
    'warmtefonds_in_behandeling',
    'warmtefonds_goedgekeurd',
    'warmtefonds_afgewezen'
  );

-- Oude WF- / aanbetaling-hoofdstatus → één opstartfase
update public.projecten
set status = 'schouwweek_inplannen'
where status in (
  'aanbetaling_verstuurd',
  'aanbetaling_betaald',
  'warmtefonds_afspraak_ingepland',
  'warmtefonds_aangevraagd',
  'warmtefonds_in_behandeling',
  'warmtefonds_goedgekeurd',
  'warmtefonds_afgewezen'
);

create index if not exists projecten_financiering_status_idx
  on public.projecten (financiering_status)
  where financiering_status is not null;

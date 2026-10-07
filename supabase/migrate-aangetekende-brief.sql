-- Aangetekende brief Warmtefonds: medewerking of annuleringskosten

alter table public.projecten
  add column if not exists aangetekende_brief_verstuurd_at timestamptz null;

comment on column public.projecten.aangetekende_brief_verstuurd_at is
  'Moment waarop de aangetekende brief (WF-medewerking of annuleringskosten) is afgehandeld/verstuurd.';

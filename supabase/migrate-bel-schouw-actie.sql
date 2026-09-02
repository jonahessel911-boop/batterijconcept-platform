-- Eerste backoffice-actie: lead bellen voor schouw (+ aanbetaling)
alter table public.projecten
  add column if not exists bel_schouw_aanbetaling_at timestamptz;

comment on column public.projecten.bel_schouw_aanbetaling_at is
  'Wanneer backoffice de lead heeft gebeld voor schouw (+ aanbetaling); null = open actie';

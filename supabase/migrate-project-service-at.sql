-- Service-afspraak op project (planbord + CRM).
alter table public.projecten
  add column if not exists service_at timestamptz,
  add column if not exists service_notities text;

create index if not exists projecten_service_at_idx
  on public.projecten (service_at)
  where service_at is not null;

comment on column public.projecten.service_at is
  'Geplande service-afspraak (datum+tijd) voor planbord.';
comment on column public.projecten.service_notities is
  'Notities bij geplande service-afspraak.';

-- Salescockpit: persoonlijke weektargets. Alleen toevoegen, bestaande tabellen blijven staan.
-- Niet automatisch uitvoeren. Draai dit zelf in de Supabase SQL-editor.

create table if not exists public.sales_cockpit_weektargets (
  id            uuid primary key default gen_random_uuid(),
  adviseur_id   uuid not null references public.adviseurs(id) on delete cascade,
  week_key      text not null,
  gelopen_doel  integer,
  deals_doel    integer,
  conversie_doel numeric(5,2),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  unique (adviseur_id, week_key),
  constraint sales_cockpit_weektargets_week_key check (week_key ~ '^\d{4}-W\d{2}$')
);

create table if not exists public.sales_cockpit_weektarget_events (
  id             uuid primary key default gen_random_uuid(),
  adviseur_id    uuid not null,
  week_key       text not null,
  gelopen_doel   integer,
  deals_doel     integer,
  conversie_doel numeric(5,2),
  actor_id       uuid,
  created_at     timestamptz not null default now()
);

create index if not exists sales_cockpit_weektarget_events_lookup
  on public.sales_cockpit_weektarget_events (adviseur_id, week_key, created_at desc);

alter table public.sales_cockpit_weektargets enable row level security;
alter table public.sales_cockpit_weektarget_events enable row level security;

comment on table public.sales_cockpit_weektargets is
  'Admin weektargets salesrapportage. Geen beleid op bestaande CRM-tabellen.';

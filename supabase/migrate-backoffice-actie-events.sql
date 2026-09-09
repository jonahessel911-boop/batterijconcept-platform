-- Voltooide backoffice-acties (voor KPI: vóór deadline / per medewerker)
-- Run in Supabase SQL Editor

create table if not exists public.backoffice_actie_events (
  id uuid primary key default gen_random_uuid(),
  soort text not null
    check (soort in (
      'bel_schouw_aanbetaling',
      'schakel_financiering',
      'nabellen_factuur',
      'herplan_afspraak'
    )),
  lead_id uuid references public.leads(id) on delete set null,
  project_id uuid references public.projecten(id) on delete set null,
  factuur_id uuid references public.facturen(id) on delete set null,
  adviseur_id uuid references public.adviseurs(id) on delete set null,
  deadline_at timestamptz,
  completed_at timestamptz not null default now(),
  on_time boolean,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists backoffice_actie_events_completed_idx
  on public.backoffice_actie_events (completed_at);

create index if not exists backoffice_actie_events_adviseur_idx
  on public.backoffice_actie_events (adviseur_id, completed_at);

comment on table public.backoffice_actie_events is
  'Log van voltooide backoffice-acties voor rapportage (SLA / per medewerker)';

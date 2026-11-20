-- Doorschuiven van open Acties naar een latere dag (niet-afgerond).
-- Run in Supabase SQL Editor

create table if not exists public.backoffice_actie_snooze (
  actie_id text primary key,
  tot timestamptz not null,
  adviseur_id uuid references public.adviseurs(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists backoffice_actie_snooze_tot_idx
  on public.backoffice_actie_snooze (tot);

comment on table public.backoffice_actie_snooze is
  'Actie doorgeschoven tot dit moment — daarna weer in de werkvoorraad';

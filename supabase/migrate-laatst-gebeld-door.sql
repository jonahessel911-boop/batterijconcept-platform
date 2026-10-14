-- Wie heeft de lead het laatst afgeboekt in Bel (voor Bel-conversie rapportage).
-- Run in Supabase SQL Editor (opnieuw uitvoeren mag).

alter table public.leads
  add column if not exists laatst_gebeld_door uuid references public.adviseurs(id) on delete set null;

create index if not exists leads_laatst_gebeld_door_idx
  on public.leads (laatst_gebeld_door)
  where laatst_gebeld_door is not null;

create index if not exists leads_laatst_gebeld_at_idx
  on public.leads (laatst_gebeld_at)
  where laatst_gebeld_at is not null;

comment on column public.leads.laatst_gebeld_door is
  'Medewerker die de lead het laatst heeft afgeboekt / gebeld in Bel-tab.';

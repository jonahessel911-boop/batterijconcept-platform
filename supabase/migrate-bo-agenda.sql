-- Backoffice Taken-agenda: persoonlijke agenda-items per medewerker.
-- Run in Supabase SQL Editor.

create table if not exists public.bo_agenda (
  id uuid primary key default gen_random_uuid(),
  adviseur_id uuid not null references public.adviseurs(id) on delete cascade,
  titel text not null,
  inhoud text null,
  soort text not null default 'afspraak'
    check (soort in ('taak', 'afspraak')),
  start_at timestamptz not null,
  end_at timestamptz null,
  status text not null default 'todo'
    check (status in ('todo', 'done')),
  created_by_id uuid null references public.adviseurs(id) on delete set null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bo_agenda_adviseur_start_idx
  on public.bo_agenda (adviseur_id, start_at asc);

create index if not exists bo_agenda_open_idx
  on public.bo_agenda (adviseur_id, start_at asc)
  where status = 'todo';

comment on table public.bo_agenda is
  'Persoonlijke Taken-agenda voor backoffice-medewerkers (intern, niet installatie-planbord)';

-- Gesprek met wie + duur (30 min slots)
alter table public.sollicitatie_afspraken
  add column if not exists interviewer_id uuid null
    references public.adviseurs(id) on delete set null;

alter table public.sollicitatie_afspraken
  add column if not exists end_at timestamptz null;

update public.sollicitatie_afspraken
set end_at = start_at + interval '30 minutes'
where end_at is null;

create index if not exists idx_sollicitatie_afspraken_interviewer_start
  on public.sollicitatie_afspraken(interviewer_id, start_at);

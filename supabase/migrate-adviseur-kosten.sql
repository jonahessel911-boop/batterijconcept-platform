-- Kosten / voorschotten per adviseur (aftrekbaar op wekelijkse creditfactuur).
-- Run in Supabase SQL Editor

create table if not exists public.adviseur_kosten (
  id uuid primary key default gen_random_uuid(),
  adviseur_id uuid not null references public.adviseurs(id) on delete cascade,
  soort text not null default 'voorschot'
    check (soort in ('voorschot', 'kosten', 'correctie')),
  omschrijving text not null,
  bedrag_ex_btw numeric(12,2) not null check (bedrag_ex_btw > 0),
  status text not null default 'open'
    check (status in ('open', 'ingedekt', 'geannuleerd')),
  kosten_datum date not null default (timezone('Europe/Amsterdam', now()))::date,
  creditfactuur_id uuid null
    references public.adviseur_creditfacturen(id) on delete set null,
  ingedekt_op timestamptz null,
  aangemaakt_door uuid null references public.adviseurs(id) on delete set null,
  notities text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists adviseur_kosten_adviseur_status_idx
  on public.adviseur_kosten (adviseur_id, status, kosten_datum desc);

create index if not exists adviseur_kosten_open_idx
  on public.adviseur_kosten (status, kosten_datum desc)
  where status = 'open';

create index if not exists adviseur_kosten_creditfactuur_idx
  on public.adviseur_kosten (creditfactuur_id)
  where creditfactuur_id is not null;

comment on table public.adviseur_kosten is
  'Voorschotten/kosten per medewerker; open posten aftrekbaar op concept-creditfactuur.';

drop trigger if exists adviseur_kosten_set_updated_at on public.adviseur_kosten;
create trigger adviseur_kosten_set_updated_at
  before update on public.adviseur_kosten
  for each row execute function public.set_updated_at();

alter table public.adviseur_kosten enable row level security;

drop policy if exists "crm_adviseur_kosten_all" on public.adviseur_kosten;
drop policy if exists "crm_adviseur_kosten_anon" on public.adviseur_kosten;
create policy "crm_adviseur_kosten_all" on public.adviseur_kosten
  for all to authenticated using (true) with check (true);
create policy "crm_adviseur_kosten_anon" on public.adviseur_kosten
  for all to anon using (true) with check (true);

-- =============================================================================
-- Agenda: adviseurs + afspraken
-- Run in Supabase SQL Editor (ná schema.sql)
-- =============================================================================

create table if not exists public.adviseurs (
  id              uuid primary key default gen_random_uuid(),
  naam            text not null,
  email           text,
  telefoon        text,
  actief          boolean not null default true,
  -- werktijden (Europe/Amsterdam), slots van 60 min
  werktijd_start  time not null default '09:00',
  werktijd_eind   time not null default '17:00',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists adviseurs_set_updated_at on public.adviseurs;
create trigger adviseurs_set_updated_at
  before update on public.adviseurs
  for each row execute function public.set_updated_at();

create table if not exists public.afspraken (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid not null references public.leads(id) on delete cascade,
  adviseur_id           uuid not null references public.adviseurs(id) on delete restrict,
  start_at              timestamptz not null,
  end_at                timestamptz not null,
  status                text not null default 'gepland'
                          check (status in ('gepland','bevestigd','verzet','geannuleerd','voltooid')),
  titel                 text default 'Adviesafspraak',
  notities              text,
  -- publieke link voor verzetten / annuleren
  manage_token          text unique default encode(gen_random_bytes(24), 'hex'),
  herinnering_verstuurd boolean not null default false,
  bevestiging_verstuurd boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint afspraken_tijd_check check (end_at > start_at)
);

create index if not exists afspraken_lead_id_idx on public.afspraken (lead_id);
create index if not exists afspraken_adviseur_id_idx on public.afspraken (adviseur_id);
create index if not exists afspraken_start_at_idx on public.afspraken (start_at);
create index if not exists afspraken_status_idx on public.afspraken (status);
create index if not exists afspraken_manage_token_idx on public.afspraken (manage_token);

drop trigger if exists afspraken_set_updated_at on public.afspraken;
create trigger afspraken_set_updated_at
  before update on public.afspraken
  for each row execute function public.set_updated_at();

alter table public.adviseurs enable row level security;
alter table public.afspraken enable row level security;

drop policy if exists "crm_adviseurs_all" on public.adviseurs;
drop policy if exists "crm_adviseurs_anon" on public.adviseurs;
drop policy if exists "crm_afspraken_all" on public.afspraken;
drop policy if exists "crm_afspraken_anon" on public.afspraken;

create policy "crm_adviseurs_all" on public.adviseurs
  for all to authenticated using (true) with check (true);
create policy "crm_adviseurs_anon" on public.adviseurs
  for all to anon using (true) with check (true);

create policy "crm_afspraken_all" on public.afspraken
  for all to authenticated using (true) with check (true);
create policy "crm_afspraken_anon" on public.afspraken
  for all to anon using (true) with check (true);

-- Voorbeeldadviseurs
insert into public.adviseurs (naam, email, telefoon)
select * from (values
  ('Team Advies Noord', 'info@batterijconcept.nl', '085 800 1645'),
  ('Team Advies Zuid', 'info@batterijconcept.nl', '085 800 1645')
) as v(naam, email, telefoon)
where not exists (select 1 from public.adviseurs limit 1);

-- Datum-opties: klant kiest 1 van 3 tijden voor Service of Overstap.
-- Run in Supabase SQL Editor.

alter table public.projecten
  add column if not exists overstap_afspraak_at timestamptz null;

comment on column public.projecten.overstap_afspraak_at is
  'Geplande overstap-afspraak (klant gekozen via portaal of BO).';

create table if not exists public.project_datum_opties (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projecten (id) on delete cascade,
  soort text not null check (soort in ('service', 'overstap')),
  slot_1 timestamptz not null,
  slot_2 timestamptz not null,
  slot_3 timestamptz not null,
  status text not null default 'open'
    check (status in ('open', 'gekozen', 'geannuleerd')),
  gekozen_slot timestamptz null,
  bevestigd_naam text null,
  bevestigd_email text null,
  bevestigd_telefoon text null,
  verstuurd_at timestamptz null,
  gekozen_at timestamptz null,
  /** Notitie voor installateur (verplicht bij soort=service) */
  service_notitie text null,
  created_by uuid null references public.adviseurs (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.project_datum_opties
  add column if not exists service_notitie text null;

comment on column public.project_datum_opties.service_notitie is
  'Notitie voor installateur / serviceverzoek (bij soort=service).';

create index if not exists project_datum_opties_project_idx
  on public.project_datum_opties (project_id, soort, status);

comment on table public.project_datum_opties is
  'Uitnodiging: 3 datumopties voor Service of Overstap; klant kiest er één in Mijn portaal.';

alter table public.project_datum_opties enable row level security;

drop policy if exists "crm_project_datum_opties_all" on public.project_datum_opties;
create policy "crm_project_datum_opties_all"
  on public.project_datum_opties
  for all using (true) with check (true);

-- Unite-lijn per medewerker + realtime call-popups na gesprek.

alter table public.adviseurs
  add column if not exists unite_lijn text;

alter table public.adviseurs
  add column if not exists unite_ext text;

comment on column public.adviseurs.unite_lijn is
  'VOIPZeker DID gekoppeld aan deze medewerker (bijv. 085 800 1645 / +31858001645).';
comment on column public.adviseurs.unite_ext is
  'Unite softphone-extensie (bijv. 0200 of 200) voor outbound-match.';

create table if not exists public.call_popups (
  id uuid primary key default gen_random_uuid(),
  adviseur_id uuid not null references public.adviseurs(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  project_id uuid references public.projecten(id) on delete set null,
  call_uniqueid text,
  direction text not null default 'in',
  phase text not null default 'ended',
  from_number text,
  to_number text,
  duration_seconds integer,
  lead_naam text,
  project_nummer text,
  meta jsonb,
  dismissed_at timestamptz,
  note_saved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists call_popups_adviseur_open_idx
  on public.call_popups (adviseur_id, created_at desc)
  where dismissed_at is null;

create index if not exists call_popups_uniqueid_idx
  on public.call_popups (call_uniqueid)
  where call_uniqueid is not null;

comment on table public.call_popups is
  'Realtime after-call popup voor de medewerker op de gekoppelde Unite-lijn.';

-- Tarik → 085 800 1645 + extensie 0200 (Unite softphone)
update public.adviseurs
set
  unite_lijn = coalesce(nullif(trim(unite_lijn), ''), '085 800 1645'),
  unite_ext = coalesce(nullif(trim(unite_ext), ''), '0200')
where id = '1ae0f665-c83f-45ec-81c4-d4935bfcd040';

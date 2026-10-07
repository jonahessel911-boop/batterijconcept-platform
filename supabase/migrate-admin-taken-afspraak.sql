-- Admin-taken: ook persoonlijke afspraken (agenda + taken in één).

alter table public.admin_taken
  add column if not exists soort text not null default 'taak';

alter table public.admin_taken
  drop constraint if exists admin_taken_soort_check;

alter table public.admin_taken
  add constraint admin_taken_soort_check
  check (soort in ('taak', 'afspraak'));

alter table public.admin_taken
  add column if not exists end_at timestamptz null;

comment on column public.admin_taken.soort is
  'taak = fix-item met deadline; afspraak = persoonlijk agenda-item (start=due_at, eind=end_at)';

comment on column public.admin_taken.end_at is
  'Eindtijd voor afspraken; null bij taken';

comment on table public.admin_taken is
  'Persoonlijke admin-agenda: taken + eigen afspraken';

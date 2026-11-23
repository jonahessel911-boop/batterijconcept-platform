-- Track gebruik van "Zet in je agenda" (landing + provider-keuze).

alter table public.afspraken
  add column if not exists agenda_link_opened_at timestamptz,
  add column if not exists agenda_added_at timestamptz,
  add column if not exists agenda_provider text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'afspraken_agenda_provider_check'
  ) then
    alter table public.afspraken
      add constraint afspraken_agenda_provider_check
      check (
        agenda_provider is null
        or agenda_provider in (
          'google',
          'outlook_live',
          'outlook_office',
          'ics'
        )
      );
  end if;
end $$;

comment on column public.afspraken.agenda_link_opened_at is
  'Eerste bezoek aan /afspraak/[token]/agenda';
comment on column public.afspraken.agenda_added_at is
  'Eerste klik/download om afspraak in agenda te zetten';
comment on column public.afspraken.agenda_provider is
  'Eerste provider: google | outlook_live | outlook_office | ics';

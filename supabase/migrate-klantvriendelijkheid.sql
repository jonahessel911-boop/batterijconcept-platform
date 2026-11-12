-- CRM-beoordeling klantvriendelijkheid installateur (zichtbaar voor installatiepartner)

alter table public.projecten
  add column if not exists klantvriendelijkheid_sterren smallint;

alter table public.projecten
  add column if not exists klantvriendelijkheid_notitie text;

alter table public.projecten
  add column if not exists klantvriendelijkheid_op timestamptz;

alter table public.projecten
  add column if not exists klantvriendelijkheid_door text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projecten_klantvriendelijkheid_sterren_check'
  ) then
    alter table public.projecten
      add constraint projecten_klantvriendelijkheid_sterren_check
      check (
        klantvriendelijkheid_sterren is null
        or (klantvriendelijkheid_sterren >= 0 and klantvriendelijkheid_sterren <= 5)
      );
  end if;
end $$;

comment on column public.projecten.klantvriendelijkheid_sterren is
  'CRM 0–5 sterren voor klantvriendelijkheid van de installateur';
comment on column public.projecten.klantvriendelijkheid_notitie is
  'Notitie bij klantvriendelijkheid (zichtbaar voor installatiepartner)';
comment on column public.projecten.klantvriendelijkheid_op is
  'Moment van laatste klantvriendelijkheid-beoordeling';
comment on column public.projecten.klantvriendelijkheid_door is
  'Naam van wie de klantvriendelijkheid-beoordeling gaf';

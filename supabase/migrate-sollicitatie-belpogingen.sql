-- Recruitment belpogingen (3× bellen) + status definitief_geen_contact

alter table public.sollicitaties
  add column if not exists belpogingen integer not null default 0;

alter table public.sollicitaties
  add column if not exists belpogingen_vandaag integer not null default 0;

alter table public.sollicitaties
  add column if not exists laatst_gebeld_at timestamptz;

comment on column public.sollicitaties.belpogingen is
  'Aantal belpogingen (geen contact) — max 3';
comment on column public.sollicitaties.belpogingen_vandaag is
  'Belpogingen op de huidige Amsterdam-kalenderdag';
comment on column public.sollicitaties.laatst_gebeld_at is
  'Laatste belpoging (UTC)';

do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'sollicitaties'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%';

  if cname is not null then
    execute format('alter table public.sollicitaties drop constraint %I', cname);
  end if;
end $$;

alter table public.sollicitaties
  add constraint sollicitaties_status_check
  check (status in (
    'nieuw',
    'geen_contact',
    'definitief_geen_contact',
    'diskwalificatie',
    'gesprek_gepland',
    'gesprek_gehad',
    'gesprek_gehad_in_beoordeling',
    'gesprek_gehad_diskwalificatie',
    'aangenomen',
    'aangenomen_training_gepland',
    'aangenomen_actief'
  ));

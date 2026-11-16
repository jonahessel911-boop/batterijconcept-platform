-- Recruitment: statussen "geen_interesse" + "terugbelafspraak"
-- Terugbel blijft alleen in recruitment (sollicitaties), niet in sales-belqueue.

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
    'geen_interesse',
    'terugbelafspraak',
    'diskwalificatie',
    'gesprek_gepland',
    'gesprek_gehad',
    'gesprek_gehad_in_beoordeling',
    'gesprek_gehad_diskwalificatie',
    'aangenomen',
    'aangenomen_training_gepland',
    'aangenomen_actief'
  ));

alter table public.sollicitaties
  add column if not exists terugbel_at timestamptz,
  add column if not exists terugbel_notitie text;

create index if not exists sollicitaties_terugbel_at_idx
  on public.sollicitaties (terugbel_at)
  where status = 'terugbelafspraak' and terugbel_at is not null;

comment on column public.sollicitaties.terugbel_at is
  'Gepland terugbeltijdstip (alleen recruitment-belqueue, niet sales/callcenter)';
comment on column public.sollicitaties.terugbel_notitie is
  'Notitie bij recruitment-terugbelafspraak';

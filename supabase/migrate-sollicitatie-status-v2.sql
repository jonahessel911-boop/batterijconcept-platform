-- Recruitment: statussen gesprek_gehad + aangenomen training/actief
-- + tabel sollicitatie_taken voor vervolgacties met deadline

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
    'diskwalificatie',
    'gesprek_gepland',
    'gesprek_gehad',
    'aangenomen_training_gepland',
    'aangenomen_actief'
  ));

create table if not exists public.sollicitatie_taken (
  id uuid primary key default gen_random_uuid(),
  sollicitatie_id uuid not null references public.sollicitaties(id) on delete cascade,
  titel text not null,
  status text not null default 'todo'
    check (status in ('todo', 'doing', 'done')),
  due_at timestamptz not null,
  notities text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sollicitatie_taken_open_idx
  on public.sollicitatie_taken (status, due_at)
  where status <> 'done';

create index if not exists sollicitatie_taken_sollicitatie_idx
  on public.sollicitatie_taken (sollicitatie_id);

comment on table public.sollicitatie_taken is
  'Vervolgacties bij recruitment (o.a. na gesprek in beoordeling), met deadline';

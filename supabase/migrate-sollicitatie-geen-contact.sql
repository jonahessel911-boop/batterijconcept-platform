-- Recruitment: status "geen_contact" toevoegen

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
    'aangenomen'
  ));

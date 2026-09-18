-- Recruitment kanban: functie + statussen
-- Nieuw | Diskwalificatie | Gesprek gepland | Aangenomen

alter table public.sollicitaties
  add column if not exists functie text null;

-- Map oude statussen
update public.sollicitaties
set status = 'diskwalificatie'
where status = 'afgewezen';

update public.sollicitaties
set status = 'gesprek_gepland'
where status in ('gesprek', 'gescreend');

-- Vervang check-constraint (naam kan variëren)
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
  alter column status set default 'nieuw';

alter table public.sollicitaties
  add constraint sollicitaties_status_check
  check (status in ('nieuw', 'diskwalificatie', 'gesprek_gepland', 'aangenomen'));

create index if not exists idx_sollicitaties_functie
  on public.sollicitaties(functie);

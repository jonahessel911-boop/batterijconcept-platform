-- Marcel Klaasman plant 10/12/14/16. De oude check stond 10/13/16/19,
-- waardoor 12:00 en 14:00 niet afgeblokt konden worden.
-- Run in Supabase SQL Editor (of eenmalig via service-role als exec_sql bestaat).

do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.adviseur_afblokkingen'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%slot_hour%'
  loop
    execute format(
      'alter table public.adviseur_afblokkingen drop constraint %I',
      r.conname
    );
  end loop;
end $$;

alter table public.adviseur_afblokkingen
  add constraint adviseur_afblokkingen_slot_hour_check
  check (slot_hour in (10, 12, 13, 14, 16, 19));

do $$
declare
  r record;
begin
  if to_regclass('public.adviseur_slot_vrijgaven') is null then
    return;
  end if;
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.adviseur_slot_vrijgaven'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%slot_hour%'
  loop
    execute format(
      'alter table public.adviseur_slot_vrijgaven drop constraint %I',
      r.conname
    );
  end loop;
  execute $sql$
    alter table public.adviseur_slot_vrijgaven
      add constraint adviseur_slot_vrijgaven_slot_hour_check
      check (slot_hour in (10, 12, 13, 14, 16, 19))
  $sql$;
end $$;

comment on constraint adviseur_afblokkingen_slot_hour_check
  on public.adviseur_afblokkingen is
  'Team 10/13/16/19 + Marcel Klaasman 10/12/14/16';

-- Inbox-mappen v2
-- Belangrijk: EERST constraint droppen, DAN data updaten, DAN nieuwe constraint.
-- Anders faalt update naar o.a. ordervraag / afzegging_afspraak op de oude check.

-- 1) Oude check weg (naam kan ook inbox_mails_folder_check zijn)
alter table public.inbox_mails drop constraint if exists inbox_mails_folder_check;

-- Extra: soms heet de constraint anders — drop alle folder-checks veilig
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'inbox_mails'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%folder%'
  loop
    execute format('alter table public.inbox_mails drop constraint if exists %I', r.conname);
  end loop;
end $$;

-- 2) Data migreren (nu mag alles)
update public.inbox_mails set folder = 'ordervraag' where folder = 'inkoop';
update public.inbox_mails set folder = 'algemeen' where folder = 'lead_antwoorden';

update public.inbox_mails
set folder = 'afzegging_afspraak'
where folder = 'algemeen'
  and coalesce((raw_headers -> 'ai_effects' ->> 'cancelAfspraak'), 'false') = 'true';

-- Eventuele rare/legacy waarden → algemeen
update public.inbox_mails
set folder = 'algemeen'
where folder is null
   or folder not in (
     'algemeen',
     'service',
     'installatie',
     'ordervraag',
     'afzegging_afspraak',
     'annulering_vraag',
     'verzonden',
     'archief'
   );

-- 3) Nieuwe check
alter table public.inbox_mails
  add constraint inbox_mails_folder_check
  check (folder in (
    'algemeen',
    'service',
    'installatie',
    'ordervraag',
    'afzegging_afspraak',
    'annulering_vraag',
    'verzonden',
    'archief'
  ));

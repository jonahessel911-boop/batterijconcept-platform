-- Zorg dat status nooit null kan zijn (bestaande tabellen zonder default)
alter table public.sollicitaties
  alter column status set default 'nieuw';

update public.sollicitaties
set status = 'nieuw'
where status is null;

alter table public.sollicitaties
  alter column status set not null;

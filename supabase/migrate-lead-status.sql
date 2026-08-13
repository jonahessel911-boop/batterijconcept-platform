-- Migratie: lead statussen bijwerken naar Nieuw / Afspraak / Geen interesse / Geen contact / Deal
-- Run dit als je schema.sql al eerder hebt gedraaid.

alter table public.leads drop constraint if exists leads_status_check;

update public.leads set status = 'nieuw' where status = 'nieuw';
update public.leads set status = 'afspraak' where status in ('contact', 'offerte');
update public.leads set status = 'deal' where status = 'gewonnen';
update public.leads set status = 'geen_interesse' where status = 'verloren';

-- Onbekende oude waarden → nieuw
update public.leads
set status = 'nieuw'
where status not in ('nieuw','afspraak','geen_interesse','geen_contact','deal');

alter table public.leads
  add constraint leads_status_check
  check (status in ('nieuw','afspraak','geen_interesse','geen_contact','deal'));

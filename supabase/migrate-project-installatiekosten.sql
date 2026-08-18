-- Standaard installatiekosten per project (excl. btw)
-- Run in Supabase SQL Editor

alter table public.projecten
  alter column projectkosten set default 675;

comment on column public.projecten.projectkosten is
  'Installatiekosten excl. btw (standaard €675); gaan van omzet af in Rapportage';

update public.projecten
  set projectkosten = 675
  where projectkosten is null or projectkosten = 0;

-- Tarik belt pas sinds 2026-10-13: wis historische bel-credit vóór die dag.
-- Alleen rijen mét laatst_gebeld_at vóór 2026-10-13 (niet vandaag legen!).

with tarik as (
  select id from public.adviseurs where lower(naam) like '%tarik%' limit 1
)
update public.leads l
set laatst_gebeld_door = null
from tarik t
where l.laatst_gebeld_door = t.id
  and (
    l.laatst_gebeld_at is null
    or (l.laatst_gebeld_at at time zone 'Europe/Amsterdam')::date
        < date '2026-10-13'
  );

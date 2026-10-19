-- Kolom + index (idempotent)
alter table public.afspraken
  add column if not exists ingepland_door_id uuid
    references public.adviseurs(id) on delete set null;

create index if not exists afspraken_ingepland_door_idx
  on public.afspraken (ingepland_door_id)
  where ingepland_door_id is not null;

-- Backfill: huisbezoeken ingepland vandaag (Amsterdam) → Tarik,
-- behalve lead Ruud Schattevoet → Jona Hessel.
with ids as (
  select
    (select id from public.adviseurs
      where lower(naam) like '%tarik%'
      order by actief desc nulls last
      limit 1) as tarik_id,
    (select id from public.adviseurs
      where lower(naam) like '%jona%hessel%'
         or lower(naam) = 'jona hessel'
         or lower(naam) like 'jona%'
      order by case when lower(naam) like '%hessel%' then 0 else 1 end,
               actief desc nulls last
      limit 1) as jona_id
)
update public.afspraken a
set ingepland_door_id = case
  when lower(coalesce(l.naam, '')) like '%ruud%schattevoet%'
    or lower(coalesce(l.naam, '')) like '%schattevoet%'
    then ids.jona_id
  else ids.tarik_id
end
from public.leads l, ids
where a.lead_id = l.id
  and a.status is distinct from 'geannuleerd'
  and coalesce(a.soort, 'nieuw') not in ('bel', 'warme_bel')
  and (a.created_at at time zone 'Europe/Amsterdam')::date
      = (timezone('Europe/Amsterdam', now()))::date
  and ids.tarik_id is not null
  and ids.jona_id is not null;

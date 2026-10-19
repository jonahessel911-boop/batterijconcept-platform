-- Heal bel-conversie "Onbekend": leads met laatst_gebeld_at maar zonder
-- laatst_gebeld_door → enige actieve beller (Tarik), behalve Schattevoet → Jona.
-- Idempotent. Run in Supabase SQL Editor.

with ids as (
  select
    (select id from public.adviseurs
      where lower(naam) like '%tarik%'
        and coalesce(actief, true)
      order by actief desc nulls last
      limit 1) as tarik_id,
    (select id from public.adviseurs
      where lower(naam) like '%jona%hessel%'
         or lower(naam) = 'jona hessel'
         or (lower(naam) like 'jona%' and lower(coalesce(rol, '')) = 'admin')
      order by case when lower(naam) like '%hessel%' then 0 else 1 end,
               actief desc nulls last
      limit 1) as jona_id
)
update public.leads l
set laatst_gebeld_door = case
  when coalesce(l.naam, '') ~* 'schattevoet' then ids.jona_id
  else coalesce(l.bel_claimed_by, l.beller_id, ids.tarik_id)
end
from ids
where l.laatst_gebeld_at is not null
  and l.laatst_gebeld_door is null
  and l.laatst_gebeld_at >=
      ((timezone('Europe/Amsterdam', now())::date) - 7)::timestamp
        at time zone 'Europe/Amsterdam'
  and ids.tarik_id is not null;

-- Koppel leads aan een adviseur (eigen portfolio)
-- Run in Supabase SQL Editor (ná agenda.sql)

alter table public.leads
  add column if not exists adviseur_id uuid
    references public.adviseurs(id) on delete set null;

create index if not exists leads_adviseur_id_idx on public.leads (adviseur_id);

-- Optioneel: backfill vanuit laatste niet-geannuleerde afspraak
update public.leads l
set adviseur_id = a.adviseur_id
from (
  select distinct on (lead_id) lead_id, adviseur_id
  from public.afspraken
  where status <> 'geannuleerd'
  order by lead_id, start_at desc
) a
where l.id = a.lead_id
  and l.adviseur_id is null;

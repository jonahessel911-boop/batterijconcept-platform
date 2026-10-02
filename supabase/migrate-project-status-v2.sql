-- Migratie: nieuwe projectstatus-pipeline + betaalwijze
-- NIET automatisch uitvoeren — eerst mapping reviewen.
--
-- Remap-tabel (oud → nieuw):
--   schouw_aanbetaling      → schouwweek_inplannen
--   aanbetaling_betaald     → aanbetaling_betaald  (ongewijzigd)
--   schouw_in_afwachting    → schouwdag_ingepland
--   schouw_voltooid         → schouw_voltooid
--   restfactuur_verstuurd   → restfactuur_verstuurd
--   restfactuur_betaald     → restfactuur_betaald
--   materiaal_installatie   → materiaal_besteld
--   installatie_voltooid    → installatie_voltooid
--   service                 → service
-- Legacy (indien nog aanwezig):
--   schouw_inplannen        → schouwweek_inplannen
--   schouwweek_gepland      → aanbetaling_verstuurd
--   schouwdag_plannen       → aanbetaling_betaald
--   schouw_gepland          → schouwdag_ingepland
--   btw_factuur_eruit       → restfactuur_verstuurd
--   materiaal_inkopen       → materiaal_besteld
--   product_ingekocht       → materiaal_besteld
--   installatie_gepland     → installatie_ingepland

begin;

-- 1. Betaalwijze-kolommen
alter table public.projecten
  add column if not exists betaalwijze text
    check (betaalwijze is null or betaalwijze in ('warmtefonds', 'eigen_middelen'));

alter table public.projecten
  add column if not exists betaalwijze_gewijzigd_at timestamptz;

alter table public.projecten
  add column if not exists betaalwijze_reden text;

-- 2. Vul betaalwijze af uit lead-status / offerte.financiering_voorbehoud
-- (Postgres: target-alias "p" mag niet in FROM/JOIN — subquery gebruiken)
update public.projecten p
set betaalwijze = s.betaalwijze
from (
  select
    p2.id,
    case
      when l.status = 'sale_eigen_middelen' then 'eigen_middelen'
      when l.status = 'sale_financiering' then 'warmtefonds'
      when o.financiering_voorbehoud = false then 'eigen_middelen'
      when o.financiering_voorbehoud = true then 'warmtefonds'
      else 'warmtefonds'
    end as betaalwijze
  from public.projecten p2
  join public.leads l on l.id = p2.lead_id
  left join public.offertes o on o.id = p2.offerte_id
) s
where p.id = s.id
  and p.betaalwijze is null;

update public.projecten
set betaalwijze = 'warmtefonds'
where betaalwijze is null;

-- 3. Oude CHECK eerst weg, anders blokkeert die de remap naar nieuwe statuskeys
alter table public.projecten drop constraint if exists projecten_status_check;

-- 4. Remap statuswaarden
update public.projecten set status = 'schouwweek_inplannen'
  where status in ('schouw_aanbetaling', 'schouw_inplannen');
update public.projecten set status = 'schouwdag_ingepland'
  where status in ('schouw_in_afwachting', 'schouw_gepland');
update public.projecten set status = 'materiaal_besteld'
  where status in ('materiaal_installatie', 'materiaal_inkopen', 'product_ingekocht');
update public.projecten set status = 'installatie_ingepland'
  where status = 'installatie_gepland';
update public.projecten set status = 'restfactuur_verstuurd'
  where status = 'btw_factuur_eruit';
update public.projecten set status = 'aanbetaling_betaald'
  where status = 'schouwdag_plannen';
update public.projecten set status = 'aanbetaling_verstuurd'
  where status = 'schouwweek_gepland';

-- 5. Nieuwe CHECK-constraint
alter table public.projecten
  add constraint projecten_status_check
  check (
    status in (
      'schouwweek_inplannen',
      'aanbetaling_verstuurd',
      'aanbetaling_betaald',
      'warmtefonds_aangevraagd',
      'warmtefonds_in_behandeling',
      'warmtefonds_afgewezen',
      'warmtefonds_goedgekeurd',
      'schouwdag_ingepland',
      'schouw_voltooid',
      'restfactuur_verstuurd',
      'restfactuur_betaald',
      'materiaal_besteld',
      'installatie_ingepland',
      'installatie_voltooid',
      'review_gevraagd',
      'service',
      'annulering',
      'hold_sales_actie'
    )
  );

-- 6. Default nieuwe projecten
alter table public.projecten
  alter column status set default 'schouwweek_inplannen';

alter table public.projecten
  alter column betaalwijze set default 'warmtefonds';

commit;

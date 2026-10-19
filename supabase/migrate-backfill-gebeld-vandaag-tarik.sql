-- Alle leads die vandaag zijn gebeld → Tarik,
-- behalve Ruud Schattevoet → Jona Hessel.
-- (Bel-conversie attributie voor 2026-10-13.)

UPDATE leads
SET laatst_gebeld_door = '1ae0f665-c83f-45ec-81c4-d4935bfcd040'
WHERE laatst_gebeld_at >= (timezone('Europe/Amsterdam', now())::date)::timestamp AT TIME ZONE 'Europe/Amsterdam'
  AND laatst_gebeld_at <  ((timezone('Europe/Amsterdam', now())::date) + 1)::timestamp AT TIME ZONE 'Europe/Amsterdam'
  AND coalesce(naam, '') !~* 'schattevoet';

UPDATE leads
SET laatst_gebeld_door = '93acdada-df8b-4c9a-9941-3c8aaa7855ab'
WHERE laatst_gebeld_at >= (timezone('Europe/Amsterdam', now())::date)::timestamp AT TIME ZONE 'Europe/Amsterdam'
  AND laatst_gebeld_at <  ((timezone('Europe/Amsterdam', now())::date) + 1)::timestamp AT TIME ZONE 'Europe/Amsterdam'
  AND coalesce(naam, '') ~* 'schattevoet';

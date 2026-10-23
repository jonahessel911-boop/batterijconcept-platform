-- Standaard backoffice-eigenaar: Tarik
-- Zet projecten zonder verantwoordelijke op Tarik (actieve adviseur).

UPDATE projecten p
SET
  verantwoordelijke_id = a.id,
  updated_at = NOW()
FROM adviseurs a
WHERE p.verantwoordelijke_id IS NULL
  AND a.actief IS DISTINCT FROM false
  AND (
    lower(trim(a.naam)) = 'tarik'
    OR lower(trim(a.naam)) LIKE 'tarik %'
  );

-- Standaard backoffice-medewerker: Jona Hessel op alle projecten zonder verantwoordelijke.
-- Idempotent: raakt alleen rijen waar verantwoordelijke_id IS NULL.

UPDATE projecten
SET verantwoordelijke_id = (
  SELECT id
  FROM adviseurs
  WHERE lower(email) = 'jona@batterijconcept.nl'
     OR naam ILIKE '%jona%hessel%'
  ORDER BY CASE WHEN lower(email) = 'jona@batterijconcept.nl' THEN 0 ELSE 1 END
  LIMIT 1
)
WHERE verantwoordelijke_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM adviseurs
    WHERE lower(email) = 'jona@batterijconcept.nl'
       OR naam ILIKE '%jona%hessel%'
  );

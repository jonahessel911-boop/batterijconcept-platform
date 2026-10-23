-- Creditfacturen (klant): er is niets te innen.
-- Verzonden credits die nog als openstaand staan → automatisch voltooid.
UPDATE facturen
SET
  status = 'betaald',
  betaald_op = COALESCE(betaald_op, factuurdatum, CURRENT_DATE::text),
  vervaldatum = NULL,
  updated_at = NOW()
WHERE credit_van_factuur_id IS NOT NULL
  AND status IN ('verzonden', 'deels_betaald');

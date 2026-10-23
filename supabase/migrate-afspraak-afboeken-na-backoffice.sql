-- Deals die al via Acties/offerte naar backoffice zijn doorgezet,
-- maar waarvan lead nog op 'deal' staat / afspraak nog open → afboeken.

-- 1) Lead → sale (Warmtefonds of eigen middelen)
UPDATE leads l
SET status = CASE
  WHEN COALESCE(o.financiering_voorbehoud, false) THEN 'sale_financiering'
  ELSE 'sale_eigen_middelen'
END
FROM offertes o
INNER JOIN projecten p ON p.offerte_id = o.id
WHERE l.id = o.lead_id
  AND o.status = 'ondertekend'
  AND o.actie_required IS NOT TRUE
  AND l.status IN ('deal', 'afspraak', 'na_afspraak', 'offerte');

-- 2) Fysieke afspraken van die leads → voltooid
UPDATE afspraken a
SET status = 'voltooid'
FROM offertes o
INNER JOIN projecten p ON p.offerte_id = o.id
WHERE a.lead_id = o.lead_id
  AND o.status = 'ondertekend'
  AND o.actie_required IS NOT TRUE
  AND a.status IN ('gepland', 'bevestigd', 'verzet')
  AND a.soort IN ('nieuw', 'vervolg_fysiek');

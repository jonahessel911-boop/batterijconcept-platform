-- Openstaande vervolg_punt-afspraken: zet soort gelijk aan leadstatus
-- (vervolg_tel / vervolg_fysiek), zodat agenda Tel vs Fysiek klopt.

UPDATE afspraken a
SET soort = 'vervolg_tel'
FROM leads l
WHERE a.lead_id = l.id
  AND a.soort = 'vervolg_punt'
  AND a.status IN ('gepland', 'bevestigd', 'verzet')
  AND l.status = 'vervolg_tel';

UPDATE afspraken a
SET soort = 'vervolg_fysiek'
FROM leads l
WHERE a.lead_id = l.id
  AND a.soort = 'vervolg_punt'
  AND a.status IN ('gepland', 'bevestigd', 'verzet')
  AND l.status = 'vervolg_fysiek';

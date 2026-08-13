-- =============================================================================
-- Batterijconcept.nl CRM — seed (alleen productcatalogus)
-- Run ná schema.sql
-- =============================================================================

insert into public.producten (sku, naam, omschrijving, prijs_ex_btw, btw_percentage, eenheid)
values
  ('AE-SMILE5', 'Alpha ESS Smile5', 'Thuisbatterij 5,7 kWh bruikbaar, 1-fase', 3495.00, 21, 'stuk'),
  ('AE-SMILE5-EXP', 'Alpha ESS Smile5 uitbreiding', 'Extra batterijmodule 2,8 kWh', 1895.00, 21, 'stuk'),
  ('AE-SMILE-T10', 'Alpha ESS Smile T10', 'Thuisbatterij 10,1 kWh, 3-fase', 5495.00, 21, 'stuk'),
  ('INST-STD', 'Standaard installatie', 'Montage + inbedrijfstelling door gecertificeerde monteurs', 995.00, 21, 'stuk'),
  ('INST-COMPLEX', 'Complexe installatie', 'Installatie met meterkastaanpassing / 3-fase upgrade', 1495.00, 21, 'stuk'),
  ('ADVIES-HUIS', 'Advies aan huis', 'Gratis adviesbezoek — in offerte als €0', 0.00, 21, 'stuk')
on conflict (sku) do nothing;

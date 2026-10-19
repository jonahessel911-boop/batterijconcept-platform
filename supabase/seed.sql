-- =============================================================================
-- Batterijconcept.nl CRM — seed (alleen productcatalogus)
-- Run ná schema.sql
-- =============================================================================

-- Alpha ESS-prijzen = EXCL. btw, pakket incl. product + installatie

insert into public.producten (sku, naam, omschrijving, prijs_ex_btw, btw_percentage, eenheid, actief)
values
  ('AE-G3-S5-9.3', 'Alpha ESS G3 S5 — 9,3 kWh', '1-fase pakket incl. 5 kW omvormer + installatie · 9,3 kWh', 8381.50, 21, 'stuk', true),
  ('AE-G3-S5-18.6', 'Alpha ESS G3 S5 — 18,6 kWh', '1-fase pakket incl. 5 kW omvormer + installatie · 18,6 kWh', 11216.50, 21, 'stuk', true),
  ('AE-G3-S5-27.9', 'Alpha ESS G3 S5 — 27,9 kWh', '1-fase pakket incl. 5 kW omvormer + installatie · 27,9 kWh', 13291.50, 21, 'stuk', true),
  ('AE-G3-S5-37.2', 'Alpha ESS G3 S5 — 37,2 kWh', '1-fase pakket incl. 5 kW omvormer + installatie · 37,2 kWh', 17791.50, 21, 'stuk', true),
  ('AE-G3-S5-46.5', 'Alpha ESS G3 S5 — 46,5 kWh', '1-fase pakket incl. 5 kW omvormer + installatie · 46,5 kWh', 22791.50, 21, 'stuk', true),
  ('AE-G3-T10-9.3', 'Alpha ESS G3 T10 — 9,3 kWh', '3-fase pakket incl. 10 kW omvormer + installatie · 9,3 kWh', 8500.00, 21, 'stuk', true),
  ('AE-G3-T10-18.6', 'Alpha ESS G3 T10 — 18,6 kWh', '3-fase pakket incl. 10 kW omvormer + installatie · 18,6 kWh', 11420.00, 21, 'stuk', true),
  ('AE-G3-T10-27.9', 'Alpha ESS G3 T10 — 27,9 kWh', '3-fase pakket incl. 10 kW omvormer + installatie · 27,9 kWh', 13495.00, 21, 'stuk', true),
  ('AE-G3-T10-37.2', 'Alpha ESS G3 T10 — 37,2 kWh', '3-fase pakket incl. 10 kW omvormer + installatie · 37,2 kWh', 17995.00, 21, 'stuk', true),
  ('AE-G3-T10-46.5', 'Alpha ESS G3 T10 — 46,5 kWh', '3-fase pakket incl. 10 kW omvormer + installatie · 46,5 kWh', 22995.00, 21, 'stuk', true),
  ('ADVIES-HUIS', 'Advies aan huis', 'Gratis adviesbezoek — in offerte als €0', 0.00, 21, 'stuk', true)
on conflict (sku) do update set
  naam = excluded.naam,
  omschrijving = excluded.omschrijving,
  prijs_ex_btw = excluded.prijs_ex_btw,
  btw_percentage = excluded.btw_percentage,
  eenheid = excluded.eenheid,
  actief = excluded.actief;

update public.producten
set actief = false
where sku in ('INST-STD', 'INST-COMPLEX', 'AE-G3-10', 'AE-SMILE5', 'AE-SMILE5-EXP', 'AE-SMILE-T10');

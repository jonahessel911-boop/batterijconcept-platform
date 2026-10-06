-- Alpha ESS Meter DTSU 3CT 100A (CHINT) — verplicht bij iedere Alpha ESS inkoop
-- inkoopprijs = prijs_ex_btw

insert into public.producten (
  sku, naam, omschrijving, prijs_ex_btw, btw_percentage, eenheid, actief
)
values (
  'alpha-ess-dtsu-3ct-100a',
  'Alpha ESS Meter DTSU 3CT 100A',
  'CHINT DTSU 3CT 100A · inkoop €112,34 ex. btw · standaard bij iedere Alpha ESS order',
  112.34,
  21,
  'stuk',
  true
)
on conflict (sku) do update set
  naam = excluded.naam,
  omschrijving = excluded.omschrijving,
  prijs_ex_btw = excluded.prijs_ex_btw,
  actief = true;

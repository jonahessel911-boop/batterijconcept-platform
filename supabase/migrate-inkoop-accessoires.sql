-- Standaard G3-accessoires (inkoopprijs = prijs_ex_btw)
-- Geen inkoop_batterij e.d. — die kolommen komen pas na migrate-inkoop.sql

insert into public.producten (
  sku, naam, omschrijving, prijs_ex_btw, btw_percentage, eenheid, actief
)
values
  (
    'smile-3g-baseplate',
    'Alpha ESS Baseplate G3 Universal',
    'Universele baseplate G3 · inkoop €60 ex. btw',
    60.00,
    21,
    'stuk',
    true
  ),
  (
    'smile-g3-kabelset-9.3',
    'AlphaESS Koppelkabel Single kolom 9.3 kWh modules',
    'Koppelkabel single kolom · inkoop €29,45 ex. btw',
    29.45,
    21,
    'stuk',
    true
  )
on conflict (sku) do update set
  naam = excluded.naam,
  omschrijving = excluded.omschrijving,
  prijs_ex_btw = excluded.prijs_ex_btw,
  actief = true;

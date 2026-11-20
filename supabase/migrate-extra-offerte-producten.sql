-- Extra's: meterkast / noodstroom. Intern op de offerte, niet op de klant-PDF.

insert into public.producten (sku, naam, omschrijving, prijs_ex_btw, btw_percentage, eenheid, actief)
values
  (
    'EXTRA-METERKAST',
    'Meterkast vervangen',
    'Niet zichtbaar op de klantofferte. Korting per regel in de offerte-maker.',
    round((1000.00 / 1.21)::numeric, 2),
    21,
    'stuk',
    true
  ),
  (
    'EXTRA-NOODSTROOM',
    'Noodstroom',
    'Niet zichtbaar op de klantofferte. Korting per regel in de offerte-maker.',
    750.00,
    21,
    'stuk',
    true
  )
on conflict (sku) do update set
  naam = excluded.naam,
  omschrijving = excluded.omschrijving,
  prijs_ex_btw = excluded.prijs_ex_btw,
  btw_percentage = excluded.btw_percentage,
  eenheid = excluded.eenheid,
  actief = true;

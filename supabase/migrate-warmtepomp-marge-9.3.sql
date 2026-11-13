-- Warmtepomp-verkoopprijzen: bruto €-marge ≈ Alpha ESS 9,3 (~€4.942 excl.)
-- Catalogusbron: src/lib/warmtepomp-producten.ts
-- Run in Supabase SQL Editor. Werkt voor alle adviseur-SKU’s WP:{id}:TC-…

update public.producten set prijs_ex_btw = 13217.36 where sku like '%:TC-GT08-FE';
update public.producten set prijs_ex_btw = 14292.56 where sku like '%:TC-GT14-FE';
update public.producten set prijs_ex_btw = 12092.56 where sku like '%:TC-GT08-FER';
update public.producten set prijs_ex_btw = 13292.56 where sku like '%:TC-GT14-FER';
update public.producten set prijs_ex_btw = 8442.15 where sku like '%:TC-GT08-CAS';
update public.producten set prijs_ex_btw = 9442.15 where sku like '%:TC-GT14-CAS';

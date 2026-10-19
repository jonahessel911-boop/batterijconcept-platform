-- Standaard 3-fase pakket (G3 T10 9,3 kWh): €8585 → €8500 excl. btw
-- Run in Supabase SQL Editor

update public.producten
set prijs_ex_btw = 8500.00
where sku = 'AE-G3-T10-9.3';

-- Selfbilling: commissie/vergoeding ex btw + 21% btw (niet verlegd).
-- Corrigeert facturen waarop btw op 0 stond.

update public.adviseur_creditfacturen
set
  btw_bedrag = round((bedrag_ex_btw * 0.21)::numeric, 2),
  bedrag_inc_btw = round((bedrag_ex_btw * 1.21)::numeric, 2)
where coalesce(btw_bedrag, 0) = 0
  and coalesce(bedrag_ex_btw, 0) > 0;

update public.partner_creditfacturen
set
  btw_bedrag = round((bedrag_ex_btw * 0.21)::numeric, 2),
  bedrag_inc_btw = round((bedrag_ex_btw * 1.21)::numeric, 2)
where coalesce(btw_bedrag, 0) = 0
  and coalesce(bedrag_ex_btw, 0) > 0;

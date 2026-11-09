-- Altijd vanaf huisadres starten, ook op maandag (geen Daltonlaan-ochtendmeeting).
-- true = startadres blijft persoonlijk huisadres; maandag 10:00 is open.
alter table public.adviseurs
  add column if not exists start_vanaf_huis_maandag boolean not null default false;

comment on column public.adviseurs.start_vanaf_huis_maandag is
  'true = ook op maandag vertrekken vanaf start_adres (huis), niet vanaf Daltonlaan ochtendmeeting; maandag 10:00 standaard open';

-- Bestaande uitzonderingen (waren hardgecodeerd)
update public.adviseurs
set start_vanaf_huis_maandag = true
where id in (
  '1925468e-5645-44a0-a6fc-962b95d0f46c', -- Marcel Klaasman
  '79645a96-6684-4265-94c8-d9c623ec4bad'  -- Charafeddine Kaddouri
);

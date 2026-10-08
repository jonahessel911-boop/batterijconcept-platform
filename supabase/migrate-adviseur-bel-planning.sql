-- Of deze adviseur meedoet in het bel-systeem (agenda automatisch vullen).
-- false = niet in beste-slots / bellen-planning; agenda/beschikbaarheid blijft wel staan.
alter table public.adviseurs
  add column if not exists bel_planning boolean not null default true;

comment on column public.adviseurs.bel_planning is
  'true = meenemen in bel-systeem / beste slots om agenda te vullen; false = buiten automatische planning';

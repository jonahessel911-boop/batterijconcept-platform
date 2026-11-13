-- Aantal contactpogingen vanuit WF-portaal (Contact-knop).
alter table public.projecten
  add column if not exists warmtefonds_contact_pogingen integer not null default 0;

comment on column public.projecten.warmtefonds_contact_pogingen is
  'Hoe vaak WF-portaal Contact is gebruikt (x1, x2, … op kanban).';

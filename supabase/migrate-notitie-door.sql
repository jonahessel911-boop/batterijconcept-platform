-- Wie de backoffice-/installateur-notitie heeft gezet
alter table public.offertes
  add column if not exists backoffice_notitie_door text null,
  add column if not exists installateur_notitie_door text null;

alter table public.projecten
  add column if not exists backoffice_notitie_door text null,
  add column if not exists installateur_notitie_door text null;

comment on column public.offertes.backoffice_notitie_door is
  'Naam van de medewerker die de backoffice-notitie schreef';
comment on column public.offertes.installateur_notitie_door is
  'Naam van de medewerker die de installateur-notitie schreef';
comment on column public.projecten.backoffice_notitie_door is
  'Naam van de medewerker die de backoffice-notitie schreef';
comment on column public.projecten.installateur_notitie_door is
  'Naam van de medewerker die de installateur-notitie schreef';

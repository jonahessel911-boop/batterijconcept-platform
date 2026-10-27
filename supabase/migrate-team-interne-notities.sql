-- Interne notities over medewerkers / monteurs (Team-tab).
-- Bijv. te laat, laptop vergeten, gesprekken — alleen CRM, niet naar de medewerker.

alter table public.adviseurs
  add column if not exists interne_notities text;

comment on column public.adviseurs.interne_notities is
  'Interne HR/team-notities (gestempeld). Alleen zichtbaar in CRM Team.';

alter table public.installatie_partners
  add column if not exists interne_notities text;

comment on column public.installatie_partners.interne_notities is
  'Interne notities over monteur/partner. Alleen zichtbaar in CRM Team.';

-- Volledige CRM-blokkade (apart van actief = niet inplannen).
-- Geblokkeerd → login mag, maar CRM toont alleen "Gebruiker geblokkeerd".
alter table adviseurs
  add column if not exists geblokkeerd boolean not null default false;

comment on column adviseurs.geblokkeerd is
  'true = mag CRM niet gebruiken (popup Gebruiker geblokkeerd). actief=false = wel inloggen/agenda, niet inplannen.';

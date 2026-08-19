-- Installatie planning + herinneringsmails (schouw + installatie)
-- Run in Supabase SQL Editor

alter table public.projecten
  add column if not exists installatie_at timestamptz,
  add column if not exists installatie_notities text,
  add column if not exists installatie_mail_klant_verstuurd boolean not null default false,
  add column if not exists installatie_mail_partner_verstuurd boolean not null default false,
  add column if not exists schouw_herinnering_verstuurd boolean not null default false,
  add column if not exists installatie_herinnering_verstuurd boolean not null default false;

create index if not exists projecten_installatie_at_idx
  on public.projecten (installatie_at);

comment on column public.projecten.installatie_at is
  'Geplande installatiedatum/-tijd (Europe/Amsterdam in mails)';
comment on column public.projecten.schouw_herinnering_verstuurd is
  'Klant-herinnering 1 dag voor schouw verstuurd';
comment on column public.projecten.installatie_herinnering_verstuurd is
  'Klant-herinnering 1 dag voor installatie verstuurd';

-- Selfbilling-flow: concept → verzonden → goedgekeurd → betaald
-- + timestamps voor versturen en goedkeuren
-- Meerdere facturen per week toegestaan (concept + later verzonden)

-- Adviseurs
alter table public.adviseur_creditfacturen
  drop constraint if exists adviseur_creditfacturen_adviseur_id_week_jaar_week_nummer_key;

alter table public.adviseur_creditfacturen
  drop constraint if exists adviseur_creditfacturen_status_check;

alter table public.adviseur_creditfacturen
  add constraint adviseur_creditfacturen_status_check
  check (status in ('concept', 'verzonden', 'goedgekeurd', 'betaald', 'geannuleerd'));

alter table public.adviseur_creditfacturen
  add column if not exists verzonden_op timestamptz,
  add column if not exists goedgekeurd_op timestamptz;

comment on column public.adviseur_creditfacturen.verzonden_op is
  'Wanneer admin de factuur naar de adviseur heeft verstuurd.';
comment on column public.adviseur_creditfacturen.goedgekeurd_op is
  'Wanneer de adviseur de selfbilling-factuur heeft goedgekeurd.';

-- Partners
alter table public.partner_creditfacturen
  drop constraint if exists partner_creditfacturen_status_check;

alter table public.partner_creditfacturen
  add constraint partner_creditfacturen_status_check
  check (status in ('concept', 'verzonden', 'goedgekeurd', 'betaald', 'geannuleerd'));

alter table public.partner_creditfacturen
  add column if not exists verzonden_op timestamptz,
  add column if not exists goedgekeurd_op timestamptz;

comment on column public.partner_creditfacturen.verzonden_op is
  'Wanneer admin de factuur naar de installatiepartner heeft verstuurd.';
comment on column public.partner_creditfacturen.goedgekeurd_op is
  'Wanneer de partner de selfbilling-factuur heeft goedgekeurd.';

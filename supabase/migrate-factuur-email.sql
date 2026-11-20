-- Apart factuur-mailadres voor selfbilling creditfacturen (Te betalen).
-- Iedereen: adviseur, backoffice, beller, partner.

begin;

alter table public.adviseurs
  add column if not exists factuur_email text;

comment on column public.adviseurs.factuur_email is
  'E-mail voor creditfacturen (Te betalen). Leeg = login-e-mail.';

alter table public.installatie_partners
  add column if not exists factuur_email text;

comment on column public.installatie_partners.factuur_email is
  'E-mail voor creditfacturen (Te betalen). Leeg = portaal-e-mail.';

commit;

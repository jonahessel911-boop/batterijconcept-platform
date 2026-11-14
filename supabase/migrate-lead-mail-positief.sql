-- Positieve e-mailintent → belprioriteit (vooraan in bellijst).

alter table public.leads
  add column if not exists mail_positief_at timestamptz null;

alter table public.leads
  add column if not exists mail_positief_samenvatting text null;

comment on column public.leads.mail_positief_at is
  'Laatste moment waarop AI een positieve bel-intent uit een inkomende mail las';

comment on column public.leads.mail_positief_samenvatting is
  'Korte AI-samenvatting van de positieve mailintent (zichtbaar in Bel)';

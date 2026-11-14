-- Monteurs koppelen aan één of meer NL-provincies (capaciteit per regio).
alter table public.installatie_partner_teamgenoten
  add column if not exists regios jsonb;

update public.installatie_partner_teamgenoten
set regios = coalesce(regios, '[]'::jsonb)
where regios is null;

alter table public.installatie_partner_teamgenoten
  alter column regios set default '[]'::jsonb;

comment on column public.installatie_partner_teamgenoten.regios is
  'JSON-array van NL-provincies waar deze monteur inzetbaar is, bijv. ["Limburg","Noord-Brabant"].';

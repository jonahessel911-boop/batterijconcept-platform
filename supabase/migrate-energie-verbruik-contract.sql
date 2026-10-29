-- Energieverbruik + contract t.b.v. Frank Energie-overstap (sale → backoffice)
-- Adviseur vult dit in bij doorzetten; BO ziet het op het project.

alter table public.offertes
  add column if not exists elektra_verbruik_kwh numeric(12, 2) null,
  add column if not exists gas_verbruik_m3 numeric(12, 2) null,
  add column if not exists teruglevering_kwh numeric(12, 2) null,
  add column if not exists energie_contract_type text null
    check (
      energie_contract_type is null
      or energie_contract_type in ('vast', 'variabel', 'dynamisch')
    ),
  add column if not exists energie_contract_einddatum date null;

alter table public.projecten
  add column if not exists elektra_verbruik_kwh numeric(12, 2) null,
  add column if not exists gas_verbruik_m3 numeric(12, 2) null,
  add column if not exists teruglevering_kwh numeric(12, 2) null,
  add column if not exists energie_contract_type text null
    check (
      energie_contract_type is null
      or energie_contract_type in ('vast', 'variabel', 'dynamisch')
    ),
  add column if not exists energie_contract_einddatum date null;

comment on column public.offertes.elektra_verbruik_kwh is
  'Jaarverbruik elektra (kWh), ingevuld bij sale → backoffice';
comment on column public.offertes.gas_verbruik_m3 is
  'Jaarverbruik gas (m³), optioneel — klant kan geen gas hebben';
comment on column public.offertes.teruglevering_kwh is
  'Jaarlijkse teruglevering (kWh)';
comment on column public.offertes.energie_contract_type is
  'vast | variabel | dynamisch';
comment on column public.offertes.energie_contract_einddatum is
  'Einddatum vast contract (verplicht bij type vast)';

comment on column public.projecten.elektra_verbruik_kwh is
  'Kopie van offerte — voor Frank Energie-overstap door backoffice';
comment on column public.projecten.gas_verbruik_m3 is
  'Kopie van offerte — gas optioneel';
comment on column public.projecten.teruglevering_kwh is
  'Kopie van offerte';
comment on column public.projecten.energie_contract_type is
  'vast | variabel | dynamisch';
comment on column public.projecten.energie_contract_einddatum is
  'Einddatum vast contract';

-- Inkoop: kosten per product + globale defaults
-- Run in Supabase SQL Editor

alter table public.producten
  add column if not exists inkoop_batterij numeric(12,2) not null default 0,
  add column if not exists inkoop_omvormer numeric(12,2) not null default 0,
  add column if not exists inkoop_installatie numeric(12,2) not null default 0,
  add column if not exists inkoop_warmtefonds numeric(12,2) not null default 0;

comment on column public.producten.inkoop_batterij is 'Inkoop batterij excl. btw';
comment on column public.producten.inkoop_omvormer is 'Inkoop omvormer excl. btw';
comment on column public.producten.inkoop_installatie is 'Installatiekosten excl. btw';
comment on column public.producten.inkoop_warmtefonds is 'Warmtefonds-aanvraag kosten excl. btw';

create table if not exists public.inkoop_instellingen (
  id integer primary key default 1 check (id = 1),
  installatie_standaard numeric(12,2) not null default 675,
  warmtefonds_aanvraag numeric(12,2) not null default 175,
  updated_at timestamptz not null default now()
);

insert into public.inkoop_instellingen (id, installatie_standaard, warmtefonds_aanvraag)
values (1, 675, 175)
on conflict (id) do nothing;

alter table public.inkoop_instellingen enable row level security;

drop policy if exists "crm_inkoop_instellingen_all" on public.inkoop_instellingen;
drop policy if exists "crm_inkoop_instellingen_anon" on public.inkoop_instellingen;
create policy "crm_inkoop_instellingen_all" on public.inkoop_instellingen
  for all to authenticated using (true) with check (true);
create policy "crm_inkoop_instellingen_anon" on public.inkoop_instellingen
  for all to anon using (true) with check (true);

-- Standaard inkoop Alpha ESS (modules × 9,3 kWh)
-- batterij 1499.73 / module · omvormer 1089.62 · installatie 675 · warmtefonds 175

update public.producten set
  inkoop_batterij = 1499.73,
  inkoop_omvormer = 1089.62,
  inkoop_installatie = 675,
  inkoop_warmtefonds = 175
where sku in ('AE-G3-S5-9.3', 'AE-G3-T10-9.3');

update public.producten set
  inkoop_batterij = 2999.46,
  inkoop_omvormer = 1089.62,
  inkoop_installatie = 675,
  inkoop_warmtefonds = 175
where sku in ('AE-G3-S5-18.6', 'AE-G3-T10-18.6');

update public.producten set
  inkoop_batterij = 4499.19,
  inkoop_omvormer = 1089.62,
  inkoop_installatie = 675,
  inkoop_warmtefonds = 175
where sku in ('AE-G3-S5-27.9', 'AE-G3-T10-27.9');

update public.producten set
  inkoop_batterij = 5998.92,
  inkoop_omvormer = 1089.62,
  inkoop_installatie = 675,
  inkoop_warmtefonds = 175
where sku in ('AE-G3-S5-37.2', 'AE-G3-T10-37.2');

update public.producten set
  inkoop_batterij = 7498.65,
  inkoop_omvormer = 1089.62,
  inkoop_installatie = 675,
  inkoop_warmtefonds = 175
where sku in ('AE-G3-S5-46.5', 'AE-G3-T10-46.5');

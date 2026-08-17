-- Terugbellen-markering + notitie op leads
-- Run in Supabase SQL Editor

alter table public.leads
  add column if not exists terugbellen boolean not null default false,
  add column if not exists terugbel_notitie text;

create index if not exists leads_terugbellen_idx
  on public.leads (terugbellen)
  where terugbellen = true;

comment on column public.leads.terugbellen is
  'Lead moet teruggebeld worden; toont badge in CRM';
comment on column public.leads.terugbel_notitie is
  'Interne terugbelnotitie, zichtbaar op de lead';

-- Max 2 belpogingen per lead per dag
-- Run in Supabase SQL Editor (als migrate-lead-belpogingen.sql al gedraaid is)

alter table public.leads
  add column if not exists belpogingen_vandaag integer not null default 0;

comment on column public.leads.belpogingen_vandaag is
  'Belpogingen op de kalenderdag van laatst_gebeld_at (max 2 per dag)';

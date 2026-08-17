-- Belpogingen voor het belsysteem (max 7, daarna uit de bellijst)
-- Run in Supabase SQL Editor

alter table public.leads
  add column if not exists belpogingen integer not null default 0,
  add column if not exists laatst_gebeld_at timestamptz,
  add column if not exists belpogingen_vandaag integer not null default 0;

create index if not exists leads_bel_queue_idx
  on public.leads (status, belpogingen, laatst_gebeld_at);

comment on column public.leads.belpogingen is
  'Aantal belpogingen zonder contact; bij 7 uit de bellijst';
comment on column public.leads.laatst_gebeld_at is
  'Laatste belpoging vanuit het belsysteem';
comment on column public.leads.belpogingen_vandaag is
  'Belpogingen op de kalenderdag van laatst_gebeld_at (max 2 per dag)';

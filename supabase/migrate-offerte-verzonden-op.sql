-- Moment waarop de offerte voor het eerst naar de klant is verstuurd.
-- Run in Supabase SQL Editor

alter table public.offertes
  add column if not exists verzonden_op timestamptz;

comment on column public.offertes.verzonden_op is
  'Eerste verzending naar klant (mail + status verzonden).';

-- Backfill: bestaande verzonden/ondertekend → created_at als proxy
update public.offertes
set verzonden_op = created_at
where verzonden_op is null
  and status in ('verzonden', 'ondertekend');

create index if not exists offertes_verzonden_op_idx
  on public.offertes (verzonden_op)
  where verzonden_op is not null;

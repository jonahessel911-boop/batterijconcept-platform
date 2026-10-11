-- Inkoop leverancier-betaling: betaald vs op krediet (factuur)
-- Run in Supabase SQL Editor

alter table public.projecten
  add column if not exists inkoop_leverancier_status text not null default 'geen'
    check (inkoop_leverancier_status in ('geen', 'betaald', 'op_krediet')),
  add column if not exists inkoop_leverancier_betaald_op timestamptz null;

comment on column public.projecten.inkoop_leverancier_status is
  'Leverancierbetaling: geen | betaald | op_krediet (factuur, nog te betalen)';
comment on column public.projecten.inkoop_leverancier_betaald_op is
  'Moment waarop leverancier is betaald (bij status betaald)';

create index if not exists projecten_inkoop_leverancier_status_idx
  on public.projecten (inkoop_leverancier_status)
  where inkoop_leverancier_status = 'op_krediet';

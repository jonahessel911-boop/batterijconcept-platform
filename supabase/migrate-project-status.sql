-- Projectstatussen: nieuwe workflow na ondertekende offerte
-- Run in Supabase SQL Editor

alter table public.projecten drop constraint if exists projecten_status_check;

update public.projecten
set status = case status
  when 'gepland' then 'schouw_inplannen'
  when 'in_uitvoering' then 'installatie_gepland'
  when 'wacht_op_materiaal' then 'product_ingekocht'
  when 'opgeleverd' then 'installatie_voltooid'
  when 'geannuleerd' then 'schouw_inplannen'
  else status
end
where status in (
  'gepland',
  'in_uitvoering',
  'wacht_op_materiaal',
  'opgeleverd',
  'geannuleerd'
);

alter table public.projecten
  alter column status set default 'schouw_inplannen';

alter table public.projecten
  add constraint projecten_status_check
  check (
    status in (
      'schouw_inplannen',
      'btw_factuur_eruit',
      'product_ingekocht',
      'installatie_gepland',
      'installatie_voltooid',
      'service'
    )
  );

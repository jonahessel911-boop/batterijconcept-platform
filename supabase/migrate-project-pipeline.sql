-- Backoffice-pipeline: eenvoudige statussen
-- Run in Supabase SQL Editor

alter table public.projecten drop constraint if exists projecten_status_check;

update public.projecten
set status = case status
  when 'schouw_inplannen' then 'schouw_aanbetaling'
  when 'schouwweek_gepland' then 'schouw_aanbetaling'
  when 'schouwdag_plannen' then 'schouw_aanbetaling'
  when 'schouw_gepland' then 'schouw_in_afwachting'
  when 'materiaal_inkopen' then 'materiaal_installatie'
  when 'btw_factuur_eruit' then 'restfactuur_verstuurd'
  when 'product_ingekocht' then 'materiaal_installatie'
  when 'installatie_gepland' then 'materiaal_installatie'
  when 'installatie_voltooid' then 'installatie_voltooid'
  when 'service' then 'service'
  else status
end
where status in (
  'schouw_inplannen',
  'schouwweek_gepland',
  'schouwdag_plannen',
  'schouw_gepland',
  'materiaal_inkopen',
  'btw_factuur_eruit',
  'product_ingekocht',
  'installatie_gepland'
);

alter table public.projecten
  alter column status set default 'schouw_aanbetaling';

alter table public.projecten
  add constraint projecten_status_check
  check (
    status in (
      'schouw_aanbetaling',
      'aanbetaling_betaald',
      'schouw_in_afwachting',
      'schouw_voltooid',
      'restfactuur_verstuurd',
      'restfactuur_betaald',
      'materiaal_installatie',
      'installatie_voltooid',
      'service'
    )
  );

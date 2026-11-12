-- WF-agenda: telefonisch vs fysiek op de afspraakkaart
-- Handmatig in Supabase SQL editor uitvoeren indien nodig.

alter table public.projecten
  add column if not exists warmtefonds_afspraak_soort text;

alter table public.projecten
  drop constraint if exists projecten_warmtefonds_afspraak_soort_check;

alter table public.projecten
  add constraint projecten_warmtefonds_afspraak_soort_check
  check (
    warmtefonds_afspraak_soort is null
    or warmtefonds_afspraak_soort in ('tel', 'fysiek')
  );

comment on column public.projecten.warmtefonds_afspraak_soort is
  'WF-afspraak: tel = telefonisch, fysiek = op locatie. Null = onbekend/eerste afspraak.';

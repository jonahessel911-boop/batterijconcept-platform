-- Schouw plant op ISO-weeknummer; exacte dag/tijd volgt ~1 week van tevoren.
alter table public.projecten
  add column if not exists schouw_jaar integer,
  add column if not exists schouw_week smallint;

comment on column public.projecten.schouw_jaar is
  'ISO-weekjaar van de geplande schouw';
comment on column public.projecten.schouw_week is
  'ISO-weeknummer (1–53) van de geplande schouw';
comment on column public.projecten.schouw_at is
  'Maandag 12:00 Europe/Amsterdam van de schouwweek (voor sorting/agenda); exacte tijd volgt later';

-- Bestaande schouw_at → week/jaar (Amsterdam)
update public.projecten p
set
  schouw_jaar = extract(isoyear from (p.schouw_at at time zone 'Europe/Amsterdam'))::integer,
  schouw_week = extract(week from (p.schouw_at at time zone 'Europe/Amsterdam'))::smallint
where p.schouw_at is not null
  and (p.schouw_jaar is null or p.schouw_week is null);

create index if not exists projecten_schouw_week_idx
  on public.projecten (schouw_jaar, schouw_week)
  where schouw_week is not null;

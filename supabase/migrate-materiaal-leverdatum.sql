-- Verwachte leverdatum inkoop-materiaal (Planbord: oranje LEVERING).

alter table public.projecten
  add column if not exists materiaal_leverdatum timestamptz null;

create index if not exists projecten_materiaal_leverdatum_idx
  on public.projecten (materiaal_leverdatum)
  where materiaal_leverdatum is not null;

comment on column public.projecten.materiaal_leverdatum is
  'Verwachte leverdatum van besteld inkoop-materiaal (Planbord LEVERING)';

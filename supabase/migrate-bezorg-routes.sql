-- Draft bezorg-routes: batterijen uit Purchasing "Geleverd" afleveren vanaf HQ.

create table if not exists public.bezorg_routes (
  id uuid primary key default gen_random_uuid(),
  datum date not null,
  bezorger_naam text not null,
  bezorger_sollicitatie_id uuid null references public.sollicitaties(id) on delete set null,
  status text not null default 'concept'
    check (status in ('concept', 'onderweg', 'afgerond')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bezorg_routes_datum_idx on public.bezorg_routes (datum desc);

create table if not exists public.bezorg_route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.bezorg_routes(id) on delete cascade,
  project_id uuid not null references public.projecten(id) on delete cascade,
  volgorde int not null default 0,
  adres text not null default '',
  lat double precision null,
  lng double precision null,
  handtekening_data_url text null,
  ontvanger_naam text null,
  geleverd_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (route_id, project_id)
);

create index if not exists bezorg_route_stops_route_idx
  on public.bezorg_route_stops (route_id, volgorde);

create index if not exists bezorg_route_stops_project_geleverd_idx
  on public.bezorg_route_stops (project_id)
  where geleverd_at is not null;

-- Drive: mappen + PDF-bestanden (privé storage)
-- Run in Supabase SQL Editor

create table if not exists public.drive_mappen (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.drive_mappen(id) on delete cascade,
  naam text not null,
  created_by uuid references public.adviseurs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists drive_mappen_parent_idx
  on public.drive_mappen (parent_id);

create table if not exists public.drive_bestanden (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.drive_mappen(id) on delete cascade,
  naam text not null,
  storage_path text not null,
  bestandsnaam text,
  mime_type text,
  grootte_bytes integer,
  uploaded_by uuid references public.adviseurs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists drive_bestanden_map_idx
  on public.drive_bestanden (map_id);

comment on table public.drive_mappen is
  'Mappen in de platform-Drive (Google Drive-achtig)';
comment on table public.drive_bestanden is
  'PDF-bestanden in Drive; altijd in een map (map_id verplicht)';

alter table public.drive_mappen enable row level security;
alter table public.drive_bestanden enable row level security;

drop policy if exists "crm_drive_mappen_all" on public.drive_mappen;
create policy "crm_drive_mappen_all" on public.drive_mappen
  for all using (true) with check (true);

drop policy if exists "crm_drive_bestanden_all" on public.drive_bestanden;
create policy "crm_drive_bestanden_all" on public.drive_bestanden
  for all using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('drive', 'drive', false)
on conflict (id) do nothing;

drop policy if exists "drive_storage_all" on storage.objects;
create policy "drive_storage_all"
  on storage.objects
  for all
  using (bucket_id = 'drive')
  with check (bucket_id = 'drive');

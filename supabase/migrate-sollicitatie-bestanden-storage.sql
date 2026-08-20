-- Storage bucket + policies voor sollicitatie-bijlagen
insert into storage.buckets (id, name, public)
values ('sollicitaties', 'sollicitaties', false)
on conflict (id) do nothing;

-- Service role / backend uploads (en signed URL downloads)
drop policy if exists "sollicitaties_storage_all" on storage.objects;
create policy "sollicitaties_storage_all"
  on storage.objects
  for all
  using (bucket_id = 'sollicitaties')
  with check (bucket_id = 'sollicitaties');

-- Zorg dat metadatatabel bestaat en RLS open is voor CRM (service role bypass)
alter table if exists public.sollicitatie_bestanden enable row level security;

drop policy if exists "crm_sollicitatie_bestanden_all" on public.sollicitatie_bestanden;
drop policy if exists "crm_sollicitatie_bestanden_anon" on public.sollicitatie_bestanden;
create policy "crm_sollicitatie_bestanden_all" on public.sollicitatie_bestanden
  for all using (true) with check (true);
create policy "crm_sollicitatie_bestanden_anon" on public.sollicitatie_bestanden
  for all using (true) with check (true);

-- Adviseur-profielfoto (Instellingen-tab + Weekmeeting-avatars).
-- Run in Supabase SQL Editor.

alter table public.adviseurs
  add column if not exists profielfoto_path text;

comment on column public.adviseurs.profielfoto_path is
  'Pad in storage-bucket adviseur-fotos, bijv. <id>/avatar.jpg';

insert into storage.buckets (id, name, public)
values ('adviseur-fotos', 'adviseur-fotos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "adviseur_fotos_public_read" on storage.objects;
create policy "adviseur_fotos_public_read"
  on storage.objects
  for select
  using (bucket_id = 'adviseur-fotos');

drop policy if exists "adviseur_fotos_storage_all" on storage.objects;
create policy "adviseur_fotos_storage_all"
  on storage.objects
  for all
  using (bucket_id = 'adviseur-fotos')
  with check (bucket_id = 'adviseur-fotos');

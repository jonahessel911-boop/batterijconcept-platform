-- Klant track & trace: unieke magic-link token per offerte

alter table public.offertes
  add column if not exists track_token text;

update public.offertes
set track_token = encode(gen_random_bytes(24), 'hex')
where track_token is null;

alter table public.offertes
  alter column track_token set default encode(gen_random_bytes(24), 'hex');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'offertes_track_token_key'
  ) then
    alter table public.offertes
      add constraint offertes_track_token_key unique (track_token);
  end if;
end $$;

create index if not exists offertes_track_token_idx
  on public.offertes (track_token);

comment on column public.offertes.track_token is
  'Magic-link token voor klant track & trace (/track/{token})';

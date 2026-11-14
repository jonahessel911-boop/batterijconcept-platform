-- Installatieportaal: wachtwoord-login, rollen, monteur-capaciteiten & ervaring

-- Partner (beheerder) wachtwoord
alter table public.installatie_partners
  add column if not exists password_hash text;

comment on column public.installatie_partners.password_hash is
  'scrypt salt:hash voor beheerder-login op /installatie/login';

-- Teamgenoot: auth + rol + capaciteiten + leeftijd + merken
alter table public.installatie_partner_teamgenoten
  add column if not exists password_hash text;

alter table public.installatie_partner_teamgenoten
  add column if not exists rol text;

alter table public.installatie_partner_teamgenoten
  add column if not exists kan_schouw boolean;

alter table public.installatie_partner_teamgenoten
  add column if not exists kan_installatie boolean;

alter table public.installatie_partner_teamgenoten
  add column if not exists leeftijd integer;

alter table public.installatie_partner_teamgenoten
  add column if not exists merken_ervaring jsonb;

-- Defaults voor bestaande rijen
update public.installatie_partner_teamgenoten
set rol = coalesce(nullif(trim(rol), ''), 'monteur')
where rol is null or trim(rol) = '';

update public.installatie_partner_teamgenoten
set kan_schouw = coalesce(kan_schouw, false)
where kan_schouw is null;

update public.installatie_partner_teamgenoten
set kan_installatie = coalesce(kan_installatie, true)
where kan_installatie is null;

update public.installatie_partner_teamgenoten
set merken_ervaring = coalesce(merken_ervaring, '[]'::jsonb)
where merken_ervaring is null;

alter table public.installatie_partner_teamgenoten
  alter column rol set default 'monteur';

alter table public.installatie_partner_teamgenoten
  alter column kan_schouw set default false;

alter table public.installatie_partner_teamgenoten
  alter column kan_installatie set default true;

alter table public.installatie_partner_teamgenoten
  alter column merken_ervaring set default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'installatie_partner_teamgenoten_rol_check'
  ) then
    alter table public.installatie_partner_teamgenoten
      add constraint installatie_partner_teamgenoten_rol_check
      check (rol in ('beheerder', 'monteur'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'installatie_partner_teamgenoten_leeftijd_check'
  ) then
    alter table public.installatie_partner_teamgenoten
      add constraint installatie_partner_teamgenoten_leeftijd_check
      check (leeftijd is null or (leeftijd >= 16 and leeftijd <= 99));
  end if;
end $$;

-- Zorg dat portal_token bestaat (legacy magic-link / deep links)
alter table public.installatie_partner_teamgenoten
  add column if not exists portal_token text;

alter table public.installatie_partner_teamgenoten
  add column if not exists invite_sent_at timestamptz;

update public.installatie_partner_teamgenoten
set portal_token = encode(gen_random_bytes(24), 'hex')
where portal_token is null or length(trim(portal_token)) < 16;

create unique index if not exists installatie_partner_teamgenoten_portal_token_uidx
  on public.installatie_partner_teamgenoten (portal_token);

comment on column public.installatie_partner_teamgenoten.password_hash is
  'scrypt salt:hash voor login op /installatie/login';
comment on column public.installatie_partner_teamgenoten.rol is
  'beheerder = team+facturen+alle klussen; monteur = alleen eigen agenda';
comment on column public.installatie_partner_teamgenoten.kan_schouw is
  'Mag voor schouw worden ingepland';
comment on column public.installatie_partner_teamgenoten.kan_installatie is
  'Mag voor installatie worden ingepland (default true)';
comment on column public.installatie_partner_teamgenoten.leeftijd is
  'Leeftijd monteur (jaren)';
comment on column public.installatie_partner_teamgenoten.merken_ervaring is
  'JSON array merknamen met ervaring, bijv. ["Tesla","BYD"]';

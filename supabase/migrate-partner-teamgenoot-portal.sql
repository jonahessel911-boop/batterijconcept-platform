-- Persoonlijk portaal-token voor teamgenoten onder een installatiepartner

alter table public.installatie_partner_teamgenoten
  add column if not exists portal_token text;

alter table public.installatie_partner_teamgenoten
  add column if not exists invite_sent_at timestamptz;

-- Bestaande rijen zonder token vullen
update public.installatie_partner_teamgenoten
set portal_token = encode(gen_random_bytes(24), 'hex')
where portal_token is null or length(trim(portal_token)) < 16;

alter table public.installatie_partner_teamgenoten
  alter column portal_token set default encode(gen_random_bytes(24), 'hex');

alter table public.installatie_partner_teamgenoten
  alter column portal_token set not null;

create unique index if not exists installatie_partner_teamgenoten_portal_token_uidx
  on public.installatie_partner_teamgenoten (portal_token);

comment on column public.installatie_partner_teamgenoten.portal_token is
  'Magic-link token voor /installatie/{token} — alleen eigen projecten';
comment on column public.installatie_partner_teamgenoten.invite_sent_at is
  'Laatste uitnodigingsmail met portaallink';

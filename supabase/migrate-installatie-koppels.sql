-- Installatiekoppels: 2 monteurs + gedeelde beoordeling
create table if not exists public.installatie_partner_koppels (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.installatie_partners (id) on delete cascade,
  naam text not null,
  monteur_1_id uuid references public.installatie_partner_teamgenoten (id) on delete set null,
  monteur_2_id uuid references public.installatie_partner_teamgenoten (id) on delete set null,
  beoordeling_sterren integer,
  beoordeling_notitie text,
  actief boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installatie_partner_koppels_sterren_check
    check (beoordeling_sterren is null or (beoordeling_sterren >= 0 and beoordeling_sterren <= 5)),
  constraint installatie_partner_koppels_distinct_monteurs_check
    check (
      monteur_1_id is null
      or monteur_2_id is null
      or monteur_1_id <> monteur_2_id
    )
);

create index if not exists installatie_partner_koppels_partner_idx
  on public.installatie_partner_koppels (partner_id);

create index if not exists installatie_partner_koppels_m1_idx
  on public.installatie_partner_koppels (monteur_1_id);

create index if not exists installatie_partner_koppels_m2_idx
  on public.installatie_partner_koppels (monteur_2_id);

comment on table public.installatie_partner_koppels is
  'Installatiekoppel: named pair van 2 monteurs onder één partner, met gedeelde beoordeling.';

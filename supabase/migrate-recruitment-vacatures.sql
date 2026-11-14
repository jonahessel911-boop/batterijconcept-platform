-- Recruitment Jobs CMS (admin ATS) — publieke vacaturepagina volgt later

create table if not exists public.recruitment_vacatures (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  rol text not null,
  status text not null default 'open'
    check (status in ('open', 'dicht')),
  korte_omschrijving text null,
  lander_url text null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recruitment_vacatures_status
  on public.recruitment_vacatures(status);

create index if not exists idx_recruitment_vacatures_rol
  on public.recruitment_vacatures(rol);

alter table public.sollicitaties
  add column if not exists vacature_id uuid null
    references public.recruitment_vacatures(id) on delete set null;

create index if not exists idx_sollicitaties_vacature_id
  on public.sollicitaties(vacature_id);

-- Seed standaard open rollen (idempotent op titel)
insert into public.recruitment_vacatures (titel, rol, status, korte_omschrijving, sort_order)
select v.titel, v.rol, 'open', v.korte_omschrijving, v.sort_order
from (
  values
    (
      'Adviseur sales',
      'adviseur_sales',
      'Sales-adviseur thuisbatterijen / warmtepompen. Fulltime, NL.',
      1
    ),
    (
      'Appointment setter',
      'appointment_setter',
      'Afspraken inplannen voor adviseurs. Fulltime, NL.',
      2
    ),
    (
      'Monteur batterijen',
      'monteur',
      'Montage thuisbatterijen bij particulieren. Fulltime, NL.',
      3
    ),
    (
      'Monteur warmtepompen',
      'monteur',
      'Montage warmtepompen bij particulieren. Fulltime, NL.',
      4
    ),
    (
      'Installatieteams thuisbatterijen',
      'installateur',
      'Montage-teams voor thuisbatterijen. Fulltime, NL.',
      10
    ),
    (
      'Bezorger / bus',
      'bezorger',
      'Materiaalbezorging met bus. Rijbewijs B.',
      20
    )
) as v(titel, rol, korte_omschrijving, sort_order)
where not exists (
  select 1 from public.recruitment_vacatures existing
  where existing.titel = v.titel
);

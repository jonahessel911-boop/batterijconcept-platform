-- Koppel Meta BANEN-campagnes aan recruitment_vacatures

create table if not exists public.recruitment_campagne_koppelingen (
  campaign_id text primary key,
  campaign_name text null,
  vacature_id uuid null
    references public.recruitment_vacatures(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_recruitment_campagne_koppelingen_vacature
  on public.recruitment_campagne_koppelingen(vacature_id);

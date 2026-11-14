-- Systeem SIN-nummer van het batterijsysteem (via opleverformulier).
-- Format: precies 15 tekens, AlphaESS, start met AL (bijv. ALD… / ALB…).

alter table public.projecten
  add column if not exists systeem_sin text null;

comment on column public.projecten.systeem_sin is
  'AlphaESS systeem SIN (15 tekens, start met AL) — via opleverformulier';

-- Uniek per systeem (meerdere nulls toegestaan)
create unique index if not exists projecten_systeem_sin_uidx
  on public.projecten (systeem_sin)
  where systeem_sin is not null and length(trim(systeem_sin)) > 0;

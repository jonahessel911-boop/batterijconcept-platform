-- Backoffice-actie op ondertekende offertes + doorstroom naar projecten

alter table public.offertes
  add column if not exists actie_required boolean not null default false,
  add column if not exists backoffice_afgerond_at timestamptz null,
  add column if not exists aanbetaling_te_innen_inc numeric(12,2) null,
  add column if not exists backoffice_notitie text null,
  add column if not exists installateur_notitie text null;

alter table public.projecten
  add column if not exists aanbetaling_te_innen_inc numeric(12,2) null,
  add column if not exists backoffice_notitie text null,
  add column if not exists installateur_notitie text null;

-- Bestaande ondertekende offertes meteen als actie markeren
update public.offertes
set actie_required = true
where status = 'ondertekend'
  and (actie_required is null or actie_required = false);

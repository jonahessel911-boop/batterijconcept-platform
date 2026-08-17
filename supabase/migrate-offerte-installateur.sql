-- Interne installateur-koppeling op offertes (niet zichtbaar voor klant)
-- Na ondertekening → project.installatie_partner_id
alter table public.offertes
  add column if not exists installatie_partner_id uuid
    references public.installatie_partners(id) on delete set null;

create index if not exists offertes_installatie_partner_id_idx
  on public.offertes (installatie_partner_id);

comment on column public.offertes.installatie_partner_id is
  'Interne installateur; klant ziet dit niet. Gaat mee naar project na ondertekening.';

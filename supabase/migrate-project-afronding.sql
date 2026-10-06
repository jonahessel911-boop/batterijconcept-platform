-- Afronding na installatie: BTW terugvragen, overstap dynamische leverancier, review

alter table public.projecten
  add column if not exists btw_terugvragen_aangevraagd_at timestamptz null;

alter table public.projecten
  add column if not exists overstap_dynamische_leverancier_at timestamptz null;

alter table public.projecten
  add column if not exists review_gevraagd_at timestamptz null;

comment on column public.projecten.btw_terugvragen_aangevraagd_at is
  'Moment waarop BTW-teruggave is aangevraagd';

comment on column public.projecten.overstap_dynamische_leverancier_at is
  'Moment waarop overstap naar dynamische leverancier is aangevraagd';

comment on column public.projecten.review_gevraagd_at is
  'Moment waarop het review-verzoek is verstuurd';

update public.projecten
set review_gevraagd_at = coalesce(review_gevraagd_at, updated_at)
where review_gevraagd_at is null
  and status in ('review_gevraagd', 'service');

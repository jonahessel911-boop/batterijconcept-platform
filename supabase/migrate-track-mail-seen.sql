-- Track & trace: intro-mail + last visit in klantportaal

alter table public.offertes
  add column if not exists track_mail_verstuurd_at timestamptz null;

alter table public.offertes
  add column if not exists track_last_seen_at timestamptz null;

alter table public.offertes
  add column if not exists track_view_count integer not null default 0;

comment on column public.offertes.track_mail_verstuurd_at is
  'Moment waarop de track & trace-intromail is verstuurd (kickoff Opstarten).';

comment on column public.offertes.track_last_seen_at is
  'Laatste keer dat de klant /track/{token} opende.';

comment on column public.offertes.track_view_count is
  'Aantal keer dat het track & trace-portaal is geopend.';

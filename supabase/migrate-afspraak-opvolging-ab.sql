-- A/B opvolgingsflow na inplannen huisbezoek (intensief vs rustig).
-- Uit standaard: legacy v1-mails blijven. Aanzetten via afspraak_opvolging_ab.enabled.

create table if not exists public.afspraak_opvolging_ab (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  started_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.afspraak_opvolging_ab (id, enabled)
values (1, false)
on conflict (id) do nothing;

comment on table public.afspraak_opvolging_ab is
  'Feature flag: 50/50 intensief vs rustig opvolging na inplannen nieuw huisbezoek';

alter table public.afspraken
  add column if not exists opvolging_flow text,
  add column if not exists bevestiging_sms_verstuurd boolean not null default false,
  add column if not exists social_proof_verstuurd boolean not null default false,
  add column if not exists reminder_48u_verstuurd boolean not null default false,
  add column if not exists avond_sms_verstuurd boolean not null default false,
  add column if not exists avond_mail_verstuurd boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'afspraken_opvolging_flow_check'
  ) then
    alter table public.afspraken
      add constraint afspraken_opvolging_flow_check
      check (
        opvolging_flow is null
        or opvolging_flow in ('legacy', 'intensief', 'rustig')
      );
  end if;
end $$;

comment on column public.afspraken.opvolging_flow is
  'null/legacy = oude v1-mailsequentie; intensief/rustig = A/B flows (mail+SMS)';
comment on column public.afspraken.bevestiging_sms_verstuurd is
  'Bevestigings-SMS verstuurd (intensief/rustig)';
comment on column public.afspraken.social_proof_verstuurd is
  'Social-proof tussenmail verstuurd (alleen intensief)';
comment on column public.afspraken.reminder_48u_verstuurd is
  '48u reminder mail(+SMS) verstuurd (alleen intensief)';
comment on column public.afspraken.avond_sms_verstuurd is
  'Avond-vóór SMS verstuurd (intensief/rustig)';
comment on column public.afspraken.avond_mail_verstuurd is
  'Avond-vóór mail verstuurd (alleen intensief)';

create index if not exists afspraken_opvolging_flow_idx
  on public.afspraken (opvolging_flow)
  where opvolging_flow is not null;

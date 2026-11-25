-- Audit-log van opvolging mail/SMS (first-class, naast boolean flags op afspraken).

create table if not exists public.afspraak_opvolging_berichten (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  afspraak_id uuid references public.afspraken (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  opvolging_flow text,
  step text not null,
  channel text not null check (channel in ('email', 'sms')),
  status text not null check (status in ('sent', 'failed', 'skipped')),
  klant_naam text,
  to_email text,
  to_phone text,
  subject text,
  body_preview text,
  provider text,
  provider_message_id text,
  tag text,
  error text,
  constraint afspraak_opvolging_berichten_flow_check check (
    opvolging_flow is null
    or opvolging_flow in ('legacy', 'intensief', 'rustig')
  ),
  constraint afspraak_opvolging_berichten_step_check check (
    step in (
      'bevestiging',
      'social-proof',
      'reminder-48u',
      'avond-vooraf',
      'opwarm',
      'herinnering-24u',
      'test'
    )
  )
);

create index if not exists afspraak_opvolging_berichten_created_at_idx
  on public.afspraak_opvolging_berichten (created_at desc);

create index if not exists afspraak_opvolging_berichten_afspraak_id_idx
  on public.afspraak_opvolging_berichten (afspraak_id);

create index if not exists afspraak_opvolging_berichten_lead_id_idx
  on public.afspraak_opvolging_berichten (lead_id);

create index if not exists afspraak_opvolging_berichten_channel_idx
  on public.afspraak_opvolging_berichten (channel);

create index if not exists afspraak_opvolging_berichten_step_idx
  on public.afspraak_opvolging_berichten (step);

create index if not exists afspraak_opvolging_berichten_status_idx
  on public.afspraak_opvolging_berichten (status);

create index if not exists afspraak_opvolging_berichten_klant_naam_idx
  on public.afspraak_opvolging_berichten (klant_naam);

comment on table public.afspraak_opvolging_berichten is
  'Log van verstuurde (of mislukte) opvolging-mails/SMS per afspraak';

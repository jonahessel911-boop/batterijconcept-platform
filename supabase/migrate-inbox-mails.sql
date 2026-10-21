-- INFO-mailbox: inkomende/uitgaande mails (IMAP/SMTP volgt later)
-- Run in Supabase SQL Editor wanneer je de mailbox koppelt.
-- UX werkt al op demo-data in de CRM Inbox-tab.

create table if not exists public.inbox_mails (
  id uuid primary key default gen_random_uuid(),
  folder text not null default 'algemeen'
    check (folder in (
      'algemeen',
      'service',
      'inkoop',
      'lead_antwoorden',
      'verzonden',
      'archief'
    )),
  status text not null default 'nieuw'
    check (status in ('nieuw', 'gelezen', 'afgehandeld', 'gearchiveerd')),
  direction text not null default 'inbound'
    check (direction in ('inbound', 'outbound')),
  message_id text unique,
  in_reply_to text,
  thread_id text,
  from_name text,
  from_email text not null,
  to_email text not null default 'info@batterijconcept.nl',
  subject text not null default '',
  body_text text not null default '',
  body_html text,
  received_at timestamptz not null default now(),
  lead_id uuid references public.leads(id) on delete set null,
  project_id uuid references public.projecten(id) on delete set null,
  afspraak_id uuid references public.afspraken(id) on delete set null,
  service_verzoek_id uuid references public.service_verzoeken(id) on delete set null,
  suggested_actions text[] not null default '{}',
  ai_summary text,
  ai_reason text,
  ai_confidence numeric(4,3),
  ai_classified_at timestamptz,
  ai_function text,
  ai_effects jsonb,
  raw_headers jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inbox_mails_folder_received_idx
  on public.inbox_mails (folder, received_at desc);
create index if not exists inbox_mails_status_idx
  on public.inbox_mails (status);
create index if not exists inbox_mails_from_email_idx
  on public.inbox_mails (lower(from_email));
create index if not exists inbox_mails_lead_id_idx
  on public.inbox_mails (lead_id);
create index if not exists inbox_mails_thread_id_idx
  on public.inbox_mails (thread_id);

comment on table public.inbox_mails is
  'INFO mailbox threads; IMAP inbound + SMTP outbound. Geen order-annulering via mail-acties.';

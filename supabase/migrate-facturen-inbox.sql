-- Facturen Inbox: mailbox-tag + uitgelezen/goedgekeurde inkomende facturen

alter table public.inbox_mails
  add column if not exists mailbox text not null default 'info';

update public.inbox_mails
set mailbox = 'info'
where mailbox is null or mailbox = '';

do $$
begin
  alter table public.inbox_mails
    drop constraint if exists inbox_mails_mailbox_check;
  alter table public.inbox_mails
    add constraint inbox_mails_mailbox_check
    check (mailbox in ('info', 'facturen'));
exception
  when others then null;
end $$;

create index if not exists inbox_mails_mailbox_received_idx
  on public.inbox_mails (mailbox, received_at desc);

create table if not exists public.facturen_inbox_items (
  id uuid primary key default gen_random_uuid(),
  inbox_mail_id uuid not null references public.inbox_mails (id) on delete cascade,
  status text not null default 'te_goedkeuren'
    check (status in ('te_goedkeuren', 'goedgekeurd', 'afgewezen', 'betaald')),
  factuur_nummer text,
  bedrijfsnaam text,
  iban text,
  bedrag_ex_btw numeric(12, 2),
  bedrag_inc_btw numeric(12, 2),
  btw_bedrag numeric(12, 2),
  vervaldatum date,
  factuurdatum date,
  betaal_woensdag date,
  referentie text,
  extract_raw jsonb not null default '{}'::jsonb,
  goedgekeurd_door uuid references public.adviseurs (id) on delete set null,
  goedgekeurd_op timestamptz,
  notities text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inbox_mail_id)
);

create index if not exists facturen_inbox_items_status_idx
  on public.facturen_inbox_items (status, betaal_woensdag);

-- finance_uitbetalingen: bron voor inbox-facturen
do $$
begin
  alter table public.finance_uitbetalingen
    drop constraint if exists finance_uitbetalingen_bron_check;
  alter table public.finance_uitbetalingen
    add constraint finance_uitbetalingen_bron_check
    check (bron in (
      'adviseur_creditfactuur',
      'partner_creditfactuur',
      'edergy_factuur',
      'inkoop_project',
      'manual',
      'facturen_mailbox'
    ));
exception
  when others then null;
end $$;

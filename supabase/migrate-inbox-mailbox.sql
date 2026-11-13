-- Scheiding info@ vs facturen@ mailbox in inbox_mails
alter table public.inbox_mails
  add column if not exists mailbox text not null default 'info';

-- Bestaande rijen blijven 'info'
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

comment on column public.inbox_mails.mailbox is
  'info = info@ CRM-inbox · facturen = facturen@ centrale factuurmailbox';

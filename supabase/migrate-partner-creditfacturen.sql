-- Creditfacturen voor installatiepartners (admin maakt aan, partner ziet in portaal)

create table if not exists public.partner_creditfacturen (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references public.installatie_partners(id) on delete cascade,
  factuur_nummer  text not null unique,
  status          text not null default 'concept'
                  check (status in ('concept', 'goedgekeurd', 'betaald', 'geannuleerd')),
  week_jaar       integer,
  week_nummer     integer check (week_nummer is null or week_nummer between 1 and 53),
  periode_van     date,
  periode_tot     date,
  omschrijving    text,
  offerte_nummer  text,
  project_nummer  text,
  bedrag_ex_btw   numeric(12,2) not null default 0,
  btw_bedrag      numeric(12,2) not null default 0,
  bedrag_inc_btw  numeric(12,2) not null default 0,
  factuurdatum    date not null default (timezone('Europe/Amsterdam', now()))::date,
  betaald_op      date,
  notities        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists partner_creditfacturen_partner_idx
  on public.partner_creditfacturen (partner_id, factuurdatum desc);

drop trigger if exists partner_creditfacturen_set_updated_at on public.partner_creditfacturen;
create trigger partner_creditfacturen_set_updated_at
  before update on public.partner_creditfacturen
  for each row execute function public.set_updated_at();

alter table public.partner_creditfacturen enable row level security;

drop policy if exists "crm_partner_creditfacturen_all" on public.partner_creditfacturen;
drop policy if exists "crm_partner_creditfacturen_anon" on public.partner_creditfacturen;
create policy "crm_partner_creditfacturen_all" on public.partner_creditfacturen
  for all to authenticated using (true) with check (true);
create policy "crm_partner_creditfacturen_anon" on public.partner_creditfacturen
  for all to anon using (true) with check (true);

comment on table public.partner_creditfacturen is
  'Creditfacturen van installatiepartners; admin maakt aan, zichtbaar in installatieportaal.';

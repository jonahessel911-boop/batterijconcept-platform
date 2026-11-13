-- Centrale uitgaande betalingen (Finance-tab): goedkeuren → auto-uitbetalen
create table if not exists public.finance_uitbetalingen (
  id uuid primary key default gen_random_uuid(),
  categorie text not null
    check (categorie in (
      'adviseur',
      'installatie_partner',
      'edergy',
      'inkoop',
      'operations',
      'overig'
    )),
  bron text not null
    check (bron in (
      'adviseur_creditfactuur',
      'partner_creditfactuur',
      'edergy_factuur',
      'inkoop_project',
      'manual'
    )),
  bron_id text not null,
  begunstigde text not null,
  iban text,
  omschrijving text,
  referentie text,
  bedrag_ex_btw numeric(12, 2),
  bedrag_inc_btw numeric(12, 2) not null default 0,
  status text not null default 'te_goedkeuren'
    check (status in (
      'concept',
      'te_goedkeuren',
      'goedgekeurd',
      'in_behandeling',
      'betaald',
      'mislukt',
      'geannuleerd'
    )),
  goedgekeurd_door uuid references public.adviseurs (id) on delete set null,
  goedgekeurd_op timestamptz,
  betaald_op timestamptz,
  bunq_payment_id text,
  foutmelding text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bron, bron_id)
);

create index if not exists finance_uitbetalingen_status_idx
  on public.finance_uitbetalingen (status, created_at desc);

create index if not exists finance_uitbetalingen_categorie_idx
  on public.finance_uitbetalingen (categorie, status);

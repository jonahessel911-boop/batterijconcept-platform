-- Soft claim voor gelijktijdig bellen: 1 lead = 1 beller.
-- Run in Supabase SQL Editor (opnieuw uitvoeren mag).

alter table public.leads
  add column if not exists bel_claimed_by uuid references public.adviseurs(id) on delete set null,
  add column if not exists bel_claimed_at timestamptz;

create index if not exists leads_bel_claimed_by_idx
  on public.leads (bel_claimed_by)
  where bel_claimed_by is not null;

create index if not exists leads_bel_claimed_at_idx
  on public.leads (bel_claimed_at)
  where bel_claimed_at is not null;

-- Ruim dubbele claims per beller op (houd meest recente)
with ranked as (
  select
    id,
    row_number() over (
      partition by bel_claimed_by
      order by bel_claimed_at desc nulls last
    ) as rn
  from public.leads
  where bel_claimed_by is not null
)
update public.leads l
set bel_claimed_by = null, bel_claimed_at = null
from ranked r
where l.id = r.id and r.rn > 1;

-- Max. 1 open claim per beller
create unique index if not exists leads_one_bel_claim_per_caller
  on public.leads (bel_claimed_by)
  where bel_claimed_by is not null;

comment on column public.leads.bel_claimed_by is
  'Medewerker die deze lead nu in de Bel-tab heeft (soft lock).';
comment on column public.leads.bel_claimed_at is
  'Moment van claim / laatste heartbeat. Verloopt na ~15 min zonder heartbeat.';

-- Atomaire claim: vrij, van mij, of verlopen (TTL)
create or replace function public.try_claim_bel_lead(
  p_lead_id uuid,
  p_caller_id uuid,
  p_ttl_seconds int default 900
)
returns public.leads
language plpgsql
as $$
declare
  result public.leads;
begin
  update public.leads
  set
    bel_claimed_by = p_caller_id,
    bel_claimed_at = now()
  where id = p_lead_id
    and (
      bel_claimed_by is null
      or bel_claimed_by = p_caller_id
      or bel_claimed_at is null
      or bel_claimed_at < now() - make_interval(secs => p_ttl_seconds)
    )
  returning * into result;

  return result;
end;
$$;

comment on function public.try_claim_bel_lead(uuid, uuid, int) is
  'Atomische soft-claim voor Bel-tab; null = lead niet beschikbaar.';

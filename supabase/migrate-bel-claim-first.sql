-- Atomaire claim-next: eerste vrije lead uit een geordende lijst.
-- FOR UPDATE SKIP LOCKED: twee bellers krijgen nooit dezelfde rij.
-- Run opnieuw mag.

create or replace function public.try_claim_bel_lead(
  p_lead_id uuid,
  p_caller_id uuid,
  p_ttl_seconds int default 240
)
returns public.leads
language plpgsql
as $$
declare
  result public.leads;
begin
  perform pg_advisory_xact_lock(hashtext(p_caller_id::text));

  update public.leads
  set bel_claimed_by = null, bel_claimed_at = null
  where bel_claimed_by = p_caller_id
    and id <> p_lead_id;

  update public.leads
  set
    bel_claimed_by = p_caller_id,
    bel_claimed_at = now()
  where id = (
    select l.id
    from public.leads l
    where l.id = p_lead_id
      and (
        l.bel_claimed_by is null
        or l.bel_claimed_by = p_caller_id
        or l.bel_claimed_at is null
        or l.bel_claimed_at < now() - make_interval(secs => p_ttl_seconds)
      )
    for update skip locked
  )
  returning * into result;

  return result;
end;
$$;

comment on function public.try_claim_bel_lead(uuid, uuid, int) is
  'Atomische claim van 1 lead voor Bel-tab; null = niet beschikbaar. 1 claim per beller.';

create or replace function public.try_claim_first_bel_lead(
  p_lead_ids uuid[],
  p_caller_id uuid,
  p_ttl_seconds int default 240
)
returns public.leads
language plpgsql
as $$
declare
  v_id uuid;
  result public.leads;
begin
  if p_lead_ids is null or cardinality(p_lead_ids) = 0 then
    return null;
  end if;

  -- Zelfde beller: geen parallelle tweede claim (unique index)
  perform pg_advisory_xact_lock(hashtext(p_caller_id::text));

  update public.leads
  set bel_claimed_by = null, bel_claimed_at = null
  where bel_claimed_by = p_caller_id;

  select l.id
  into v_id
  from public.leads l
  where l.id = any (p_lead_ids)
    and (
      l.bel_claimed_by is null
      or l.bel_claimed_at is null
      or l.bel_claimed_at < now() - make_interval(secs => p_ttl_seconds)
    )
  order by array_position(p_lead_ids, l.id)
  for update skip locked
  limit 1;

  if v_id is null then
    return null;
  end if;

  update public.leads
  set
    bel_claimed_by = p_caller_id,
    bel_claimed_at = now()
  where id = v_id
  returning * into result;

  return result;
end;
$$;

comment on function public.try_claim_first_bel_lead(uuid[], uuid, int) is
  'Pakt de eerste vrije lead uit p_lead_ids (queue-volgorde). Andere bellers skippen dezelfde rij.';

comment on column public.leads.bel_claimed_at is
  'Moment van claim / laatste heartbeat. Verloopt na ~4 min zonder heartbeat.';

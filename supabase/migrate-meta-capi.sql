-- Meta Conversions API tracking per lead
-- Run in Supabase SQL Editor

alter table public.leads
  add column if not exists capi_events_sent text[] not null default '{}';

alter table public.leads
  add column if not exists meta_fbc text;

alter table public.leads
  add column if not exists meta_fbp text;

alter table public.leads
  add column if not exists meta_client_ip text;

alter table public.leads
  add column if not exists meta_user_agent text;

alter table public.leads
  add column if not exists meta_event_source_url text;

comment on column public.leads.capi_events_sent is
  'Meta CAPI events al verstuurd: QualifiedLead, Schedule, Purchase';
comment on column public.leads.meta_fbc is 'Facebook click cookie (_fbc)';
comment on column public.leads.meta_fbp is 'Facebook browser cookie (_fbp)';

-- Meta Insights lead counts naast spend (marketing CPL uit API i.p.v. CRM)
alter table public.meta_ad_spend
  add column if not exists leads integer;

comment on column public.meta_ad_spend.leads is
  'Lead-resultaten uit Meta Insights (actions: lead / lead_grouped), niet CRM.';

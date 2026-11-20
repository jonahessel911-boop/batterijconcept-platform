-- Facturen Inbox: wanneer we zelf al betaald hebben (niet wachten op woensdag-ronde)

alter table public.facturen_inbox_items
  add column if not exists betaald_op timestamptz;

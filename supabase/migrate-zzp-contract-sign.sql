-- Digitaal ondertekenen ZZP-samenwerkingsovereenkomst (adviseurs)

alter table public.adviseurs
  add column if not exists contract_sign_token text,
  add column if not exists contract_sign_status text,
  add column if not exists contract_sign_fields jsonb,
  add column if not exists contract_bc_handtekening text,
  add column if not exists contract_sent_at timestamptz,
  add column if not exists contract_signed_at timestamptz;

create unique index if not exists adviseurs_contract_sign_token_uidx
  on public.adviseurs (contract_sign_token)
  where contract_sign_token is not null;

comment on column public.adviseurs.contract_sign_token is
  'Publieke token voor ondertekenlink /contract/[token]';
comment on column public.adviseurs.contract_sign_status is
  'concept | verzonden | ondertekend';
comment on column public.adviseurs.contract_sign_fields is
  'Ingevulde velden voor pagina 7 (BC + adviseur)';

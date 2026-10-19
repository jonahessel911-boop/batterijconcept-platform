-- Adresvelden voor recruitment / sollicitaties (postcode-lookup)

alter table public.sollicitaties
  add column if not exists postcode text null,
  add column if not exists huisnummer text null,
  add column if not exists toevoeging text null,
  add column if not exists straat text null,
  add column if not exists plaats text null;

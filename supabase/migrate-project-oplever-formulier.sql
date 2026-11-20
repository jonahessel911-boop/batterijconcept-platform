-- Snapshot van het opleverformulier (zonder handtekening) voor after-sale in Acties.

alter table public.projecten
  add column if not exists oplever_formulier jsonb null;

comment on column public.projecten.oplever_formulier is
  'Opleverformulier-snapshot: datum, monteur, SIN, checklist, opmerkingen';

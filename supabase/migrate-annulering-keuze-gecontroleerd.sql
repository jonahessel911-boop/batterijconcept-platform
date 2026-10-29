-- Controledatum na mail «Keuze: annulering of installatie» (dag 6-actie).
alter table projecten
  add column if not exists annulering_keuze_gecontroleerd_at timestamptz;

comment on column projecten.annulering_keuze_gecontroleerd_at is
  'BO heeft opvolging gedaan na keuze-mail (installatie doorzetten of annuleringsfactuur).';

-- Intern vervolg punt op de agenda (na fysieke afspraak)
alter table public.afspraken
  drop constraint if exists afspraken_soort_check;

alter table public.afspraken
  add constraint afspraken_soort_check
  check (soort in ('nieuw', 'bel', 'vervolg_fysiek', 'vervolg_tel', 'vervolg_punt'));

comment on column public.afspraken.soort is
  'nieuw/vervolg_fysiek blokkeren de agenda; bel/vervolg_tel/vervolg_punt mogen overlappen (intern of telefonisch).';

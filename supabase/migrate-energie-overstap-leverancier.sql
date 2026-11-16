-- Frank / Next Energy keuze bij doorzetten sale → backoffice

alter table public.offertes
  add column if not exists energie_overstap_leverancier text null
    check (
      energie_overstap_leverancier is null
      or energie_overstap_leverancier in ('frank', 'next_energy')
    );

alter table public.projecten
  add column if not exists energie_overstap_leverancier text null
    check (
      energie_overstap_leverancier is null
      or energie_overstap_leverancier in ('frank', 'next_energy')
    );

comment on column public.offertes.energie_overstap_leverancier is
  'frank | next_energy — verplicht bij Actie afronden / doorzetten';
comment on column public.projecten.energie_overstap_leverancier is
  'Kopie van offerte — welke energieleverancier voor overstap';

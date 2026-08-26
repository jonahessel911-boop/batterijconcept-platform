-- Startadres per adviseur (waarvandaan de dag begint / eerste afspraak).
alter table adviseurs
  add column if not exists start_adres text;

comment on column adviseurs.start_adres is
  'Vertrekadres voor reistijd / Fast Direction (bijv. Alfred Nobellaan 68, 3731 DW De Bilt)';

-- Huub: De Bilt
update adviseurs
set start_adres = 'Alfred Nobellaan 68, 3731 DW De Bilt'
where start_adres is null
  and naam ilike '%huub%';

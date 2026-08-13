-- Zet adviseurs op Jona & Huub (run als je al eerdere seed had)
delete from public.adviseurs
where naam not in ('Jona', 'Huub')
  and not exists (
    select 1 from public.afspraken a where a.adviseur_id = adviseurs.id
  );

insert into public.adviseurs (naam, email, telefoon)
select v.naam, v.email, v.telefoon
from (values
  ('Jona', 'info@batterijconcept.nl', '085 800 1645'),
  ('Huub', 'info@batterijconcept.nl', '085 800 1645')
) as v(naam, email, telefoon)
where not exists (
  select 1 from public.adviseurs a where a.naam = v.naam
);

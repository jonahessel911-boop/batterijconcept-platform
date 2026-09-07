-- Zet jona@batterijconcept.nl op admin (na migrate-rollen.sql)
update public.adviseurs
set rol = 'admin', actief = true
where lower(coalesce(email, '')) = 'jona@batterijconcept.nl';

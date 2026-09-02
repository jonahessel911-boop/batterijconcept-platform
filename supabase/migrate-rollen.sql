-- Rollen op teamleden (adviseurs-tabel = CRM-logins)
-- adviseur | backoffice | admin | installateur

alter table public.adviseurs
  add column if not exists rol text not null default 'adviseur';

alter table public.adviseurs drop constraint if exists adviseurs_rol_check;
alter table public.adviseurs
  add constraint adviseurs_rol_check
  check (rol in ('adviseur', 'backoffice', 'admin', 'installateur'));

comment on column public.adviseurs.rol is
  'CRM-rol: adviseur (eigen leads), backoffice, admin (alles), installateur (portaal)';

-- Bestaande Admin-accounts
update public.adviseurs
set rol = 'admin'
where lower(coalesce(email, '')) = lower(coalesce(current_setting('app.admin_email', true), 'admin@batterijconcept.nl'))
   or lower(trim(naam)) = 'admin';

-- Fallback: bekende admin-mails
update public.adviseurs
set rol = 'admin'
where lower(coalesce(email, '')) in (
  'admin@batterijconcept.nl',
  'jona@batterijconcept.nl'
);

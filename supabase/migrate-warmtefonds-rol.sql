-- Rol "warmtefonds" (Edergy/WF-operator) + sales_manager in check constraint.
-- WF-personen zijn geen sales-adviseurs; werken via /warmtefonds/[token].

alter table public.adviseurs drop constraint if exists adviseurs_rol_check;
alter table public.adviseurs
  add constraint adviseurs_rol_check
  check (
    rol in (
      'adviseur',
      'beller',
      'backoffice',
      'sales_manager',
      'admin',
      'installateur',
      'warmtefonds'
    )
  );

comment on column public.adviseurs.rol is
  'CRM-rol: adviseur, beller, backoffice, sales_manager, admin, installateur, warmtefonds (WF-portaal)';

-- Edwin = Warmtefonds, geen sales-adviseur
update public.adviseurs
set
  rol = 'warmtefonds',
  bel_planning = false
where lower(coalesce(email, '')) = 'edwin@edergy.nl'
   or (
     lower(trim(naam)) like '%edwin%'
     and lower(trim(naam)) like '%veenendaal%'
   );

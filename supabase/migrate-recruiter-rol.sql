-- Rol "recruiter": alleen Recruitment (instroom) in het CRM.

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
      'warmtefonds',
      'recruiter'
    )
  );

comment on column public.adviseurs.rol is
  'CRM-rol: adviseur, beller, backoffice, sales_manager, admin, installateur, warmtefonds, recruiter';

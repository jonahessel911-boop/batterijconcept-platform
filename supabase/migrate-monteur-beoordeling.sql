-- Admin-beoordeling van de uitvoerende monteur per project/klus

alter table public.projecten
  add column if not exists monteur_beoordeling_sterren smallint;

alter table public.projecten
  add column if not exists monteur_beoordeling_notitie text;

alter table public.projecten
  add column if not exists monteur_beoordeling_op timestamptz;

alter table public.projecten
  add column if not exists monteur_beoordeling_door text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projecten_monteur_beoordeling_sterren_check'
  ) then
    alter table public.projecten
      add constraint projecten_monteur_beoordeling_sterren_check
      check (
        monteur_beoordeling_sterren is null
        or (monteur_beoordeling_sterren >= 0 and monteur_beoordeling_sterren <= 5)
      );
  end if;
end $$;

comment on column public.projecten.monteur_beoordeling_sterren is
  'Admin-beoordeling 0–5 sterren voor de uitvoerende monteur op deze klus';
comment on column public.projecten.monteur_beoordeling_notitie is
  'Interne notitie bij monteur-beoordeling';
comment on column public.projecten.monteur_beoordeling_op is
  'Moment van laatste monteur-beoordeling';
comment on column public.projecten.monteur_beoordeling_door is
  'Naam van wie de beoordeling gaf';

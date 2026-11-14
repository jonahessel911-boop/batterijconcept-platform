-- Deadline voor HOLD SALES ACTIE (sales heeft 3 kalenderdagen).
alter table projecten
  add column if not exists hold_sales_deadline_at timestamptz;

comment on column projecten.hold_sales_deadline_at is
  'Uiterlijke datum waarop sales de HOLD moet afhandelen; daarna BO-escalatie.';

-- Bestaande HOLDs: deadline = updated_at + 3 dagen (oudere meteen overdue).
update projecten
set hold_sales_deadline_at = updated_at + interval '3 days'
where status = 'hold_sales_actie'
  and hold_sales_deadline_at is null;

-- Log-soort voor BO-escalatie HOLD (check constraint uitbreiden indien aanwezig).
do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'backoffice_actie_events'
      and constraint_type = 'CHECK'
  ) then
    alter table public.backoffice_actie_events
      drop constraint if exists backoffice_actie_events_soort_check;
    alter table public.backoffice_actie_events
      add constraint backoffice_actie_events_soort_check
      check (soort in (
        'bel_schouw_aanbetaling',
        'schakel_financiering',
        'nabellen_factuur',
        'herplan_afspraak',
        'aangetekende_brief',
        'annulering_keuze_controle',
        'hold_sales_verlopen'
      ));
  end if;
end $$;

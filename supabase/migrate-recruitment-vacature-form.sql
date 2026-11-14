-- Multi-step sollicitatieformulier per vacature (JSON)
alter table public.recruitment_vacatures
  add column if not exists form jsonb null;

comment on column public.recruitment_vacatures.form is
  'Werkenbij multi-step form: headline, steps (buttons|text|contact), voordelen';

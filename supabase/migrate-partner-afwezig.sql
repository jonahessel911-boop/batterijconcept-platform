-- Melding bij afboeken: partner was niet aanwezig (monitoren per planner).
alter table public.afspraken
  add column if not exists partner_afwezig_gemeld_at timestamptz,
  add column if not exists partner_afwezig_gemeld_door text;

comment on column public.afspraken.partner_afwezig_gemeld_at is
  'Wanneer de adviseur bij afboeken meldde dat de partner niet aanwezig was';
comment on column public.afspraken.partner_afwezig_gemeld_door is
  'Wie die melding deed (naam)';

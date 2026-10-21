-- Voice AI: voice notes per afspraak + coaching-notities op transcript-momenten
-- Run in Supabase SQL Editor

create table if not exists public.afspraak_voice_notes (
  id uuid primary key default gen_random_uuid(),
  afspraak_id uuid not null references public.afspraken(id) on delete cascade,
  storage_path text not null,
  bestandsnaam text,
  content_type text,
  duration_sec numeric,
  status text not null default 'transcribing'
    check (status in ('transcribing', 'ready', 'error')),
  error_message text,
  transcript_text text,
  segments jsonb not null default '[]'::jsonb,
  speaker_map jsonb not null default '{}'::jsonb,
  uploaded_by_id uuid references public.adviseurs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists afspraak_voice_notes_afspraak_idx
  on public.afspraak_voice_notes (afspraak_id, created_at desc);

create index if not exists afspraak_voice_notes_status_idx
  on public.afspraak_voice_notes (status);

create table if not exists public.afspraak_voice_annotations (
  id uuid primary key default gen_random_uuid(),
  voice_note_id uuid not null references public.afspraak_voice_notes(id) on delete cascade,
  segment_id text,
  start_sec numeric not null default 0,
  end_sec numeric,
  quote_text text,
  notitie text not null,
  created_by_id uuid references public.adviseurs(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists afspraak_voice_annotations_note_idx
  on public.afspraak_voice_annotations (voice_note_id, start_sec);

-- Storage bucket (privé; signed URLs via service role)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-notes',
  'voice-notes',
  false,
  26214400,
  array[
    'audio/mpeg',
    'audio/mp4',
    'audio/m4a',
    'audio/wav',
    'audio/webm',
    'audio/ogg',
    'audio/flac',
    'audio/x-m4a',
    'video/mp4',
    'video/webm'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.afspraak_voice_notes is
  'Opgenomen huisbezoek / afspraak: audio + OpenAI diarized transcript';
comment on table public.afspraak_voice_annotations is
  'Coaching-notities op een moment in het transcript (bijv. had dit moeten zeggen)';

/** Shared types + helpers for Voice AI (afspraak voice notes). */

export type VoiceSpeakerRole = "adviseur" | "klant" | "onbekend";

export type VoiceTranscriptSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
  /** Raw diarization label (A/B/…) */
  speaker: string;
  role: VoiceSpeakerRole;
  /** Display name: klant- of adviseursnaam */
  speakerName: string;
};

export type VoiceNoteStatus = "transcribing" | "ready" | "error";

export type VoiceAnnotation = {
  id: string;
  voice_note_id: string;
  segment_id: string | null;
  start_sec: number;
  end_sec: number | null;
  quote_text: string | null;
  notitie: string;
  created_by_id: string | null;
  created_at: string;
  created_by?: { naam: string } | null;
};

export type VoiceNoteRow = {
  id: string;
  afspraak_id: string;
  storage_path: string;
  bestandsnaam: string | null;
  content_type: string | null;
  duration_sec: number | null;
  status: VoiceNoteStatus;
  error_message: string | null;
  transcript_text: string | null;
  segments: VoiceTranscriptSegment[];
  speaker_map: Record<string, VoiceSpeakerRole>;
  uploaded_by_id: string | null;
  created_at: string;
  updated_at: string;
};

export type VoiceAfspraakRow = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  soort: string | null;
  lead_id: string;
  adviseur_id: string;
  klant_naam: string;
  adviseur_naam: string;
  voice_note: {
    id: string;
    status: VoiceNoteStatus;
    created_at: string;
    duration_sec: number | null;
    annotation_count: number;
  } | null;
};

export function formatVoiceTime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function parseSegments(raw: unknown): VoiceTranscriptSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row, i) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const text = String(r.text ?? "").trim();
      if (!text) return null;
      const start = Number(r.start) || 0;
      const end = Number(r.end) || start;
      const speaker = String(r.speaker ?? "A");
      const role =
        r.role === "adviseur" || r.role === "klant" || r.role === "onbekend"
          ? r.role
          : ("onbekend" as VoiceSpeakerRole);
      return {
        id: String(r.id ?? `seg_${i}`),
        start,
        end,
        text,
        speaker,
        role,
        speakerName: String(r.speakerName ?? speaker),
      } satisfies VoiceTranscriptSegment;
    })
    .filter((x): x is VoiceTranscriptSegment => Boolean(x));
}

export function normalizeAudioFilename(name: string | undefined, mime: string): string {
  const base =
    (name || "opname").replace(/[^\w.\-]+/g, "_").slice(0, 80) || "opname";
  if (/\.(mp3|m4a|wav|webm|ogg|flac|mp4|mpeg)$/i.test(base)) return base;
  const ext =
    mime.includes("mpeg") || mime.includes("mp3")
      ? "mp3"
      : mime.includes("mp4") || mime.includes("m4a")
        ? "m4a"
        : mime.includes("wav")
          ? "wav"
          : mime.includes("ogg")
            ? "ogg"
            : mime.includes("flac")
              ? "flac"
              : "webm";
  return `${base}.${ext}`;
}

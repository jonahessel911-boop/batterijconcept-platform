"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { formatDateNl, formatTimeNl } from "@/lib/format";
import {
  formatVoiceTime,
  parseSegments,
  type VoiceAfspraakRow,
  type VoiceAnnotation,
  type VoiceNoteRow,
  type VoiceTranscriptSegment,
} from "@/lib/voice-ai";
import type {
  StraightLineReview,
  StraightLineStapReview,
} from "@/lib/straight-line-script";

type NoteDetail = {
  note: VoiceNoteRow;
  audioUrl: string | null;
  klant_naam: string;
  adviseur_naam: string;
  annotations: VoiceAnnotation[];
};

type DayGroup = {
  key: string;
  label: string;
  isToday: boolean;
  items: VoiceAfspraakRow[];
};

function amsterdamDayKey(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Amsterdam",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function todayKey(): string {
  return amsterdamDayKey(new Date().toISOString());
}

function MicIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function VoiceAiPanel() {
  const [rows, setRows] = useState<VoiceAfspraakRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [days, setDays] = useState(30);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadAfspraak = useRef<string | null>(null);

  const loadList = useCallback(async (search = q, d = days) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(d) });
      if (search.trim()) params.set("q", search.trim());
      const res = await fetch(`/api/voice-ai/afspraken?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setRows((data.afspraken as VoiceAfspraakRow[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [q, days]);

  useEffect(() => {
    void loadList();
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const openNote = useCallback(async (noteId: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/voice-ai/notes/${noteId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      const rawNote = data.note as VoiceNoteRow;
      setDetail({
        note: {
          ...rawNote,
          segments: parseSegments(rawNote.segments),
        },
        audioUrl: data.audioUrl as string | null,
        klant_naam: data.klant_naam as string,
        adviseur_naam: data.adviseur_naam as string,
        annotations: (data.annotations as VoiceAnnotation[]) || [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const selectAfspraak = useCallback(
    (row: VoiceAfspraakRow) => {
      setSelectedId(row.id);
      setDetail(null);
      if (row.voice_note?.status === "ready" || row.voice_note?.status === "error") {
        void openNote(row.voice_note.id);
      }
    },
    [openNote]
  );

  const startUpload = (afspraakId: string) => {
    pendingUploadAfspraak.current = afspraakId;
    setSelectedId(afspraakId);
    fileInputRef.current?.click();
  };

  const onFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const afspraakId = pendingUploadAfspraak.current;
    e.target.value = "";
    pendingUploadAfspraak.current = null;
    if (!file || !afspraakId) return;

    setUploadingId(afspraakId);
    setError(null);
    setDetail(null);
    try {
      const { uploadAfspraakVoiceNote } = await import(
        "@/lib/voice-ai-upload-client"
      );
      const { noteId } = await uploadAfspraakVoiceNote(afspraakId, file);
      await loadList();
      if (noteId) await openNote(noteId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload mislukt");
    } finally {
      setUploadingId(null);
    }
  };

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) || null,
    [rows, selectedId]
  );

  const dayGroups = useMemo((): DayGroup[] => {
    const today = todayKey();
    const map = new Map<string, VoiceAfspraakRow[]>();
    for (const row of rows) {
      const key = amsterdamDayKey(row.start_at);
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
    }
    // Vandaag eerst, daarna terug in de tijd (nieuwste dagen bovenaan)
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, items]) => ({
        key,
        label:
          key === today
            ? `Vandaag · ${formatDateNl(items[0]?.start_at)}`
            : formatDateNl(items[0]?.start_at),
        isToday: key === today,
        items: items.sort(
          (a, b) =>
            new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
        ),
      }));
  }, [rows]);

  const metOpname = rows.filter((r) => r.voice_note?.status === "ready").length;
  const detailMatches =
    Boolean(selected) &&
    Boolean(detail) &&
    detail!.note.afspraak_id === selected!.id;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-wash">
      {/* Top bar full width */}
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-green-deeper sm:text-2xl">
            Voice AI
          </h1>
          <p className="text-xs text-muted sm:text-sm">
            Nieuwe huisbezoeken · vandaag → {days} dagen terug · Straight Line
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void loadList(q, days);
            }}
            placeholder="Zoek klant of adviseur…"
            className="h-10 w-44 border border-line bg-white px-3 text-sm outline-none focus:border-green sm:w-56"
          />
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-10 border border-line bg-white px-3 text-sm"
          >
            <option value={30}>1 maand</option>
            <option value={14}>14 dagen</option>
            <option value={7}>7 dagen</option>
            <option value={60}>60 dagen</option>
          </select>
          <button
            type="button"
            onClick={() => void loadList(q, days)}
            className="h-10 bg-green px-4 text-sm font-semibold text-white hover:bg-green-dark"
          >
            Zoeken
          </button>
        </div>
      </header>

      {error && (
        <p className="border-b border-[#C45A12]/20 bg-[#FFF0E6] px-4 py-2.5 text-sm text-[#C45A12] sm:px-6">
          {error}
        </p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.webm,.ogg,.flac,.mp4"
        className="hidden"
        onChange={(e) => void onFileChosen(e)}
      />

      {/* Split: lijst scrollt, rechts blijft vast */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden border-r border-line bg-white">
          <div className="shrink-0 border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">Nieuwe huisbezoeken</p>
            <p className="text-[11px] text-muted">
              {rows.length} bezoeken · {metOpname} met opname
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {loading ? (
              <p className="px-4 py-12 text-center text-sm text-muted">Laden…</p>
            ) : dayGroups.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted">
                Geen nieuwe huisbezoeken in deze periode
              </p>
            ) : (
              dayGroups.map((group) => (
                <div key={group.key}>
                  <div
                    className={[
                      "sticky top-0 z-10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em]",
                      group.isToday
                        ? "bg-green text-white"
                        : "bg-wash text-muted",
                    ].join(" ")}
                  >
                    {group.label}
                    <span className="ml-2 font-normal opacity-80">
                      {group.items.length}
                    </span>
                  </div>
                  <ul>
                    {group.items.map((row) => {
                      const active = row.id === selectedId;
                      const ready = row.voice_note?.status === "ready";
                      const busy =
                        row.voice_note?.status === "transcribing" ||
                        uploadingId === row.id;
                      const failed = row.voice_note?.status === "error";
                      return (
                        <li key={row.id} className="border-b border-line/70">
                          <button
                            type="button"
                            onClick={() => selectAfspraak(row)}
                            className={[
                              "flex w-full items-center gap-3 px-4 py-3.5 text-left transition",
                              active
                                ? "bg-green-soft/60"
                                : ready
                                  ? "bg-[#F3FAF5] hover:bg-green-soft/40"
                                  : "hover:bg-wash",
                            ].join(" ")}
                          >
                            <span className="w-11 shrink-0 font-mono text-sm font-semibold tabular-nums text-ink">
                              {formatTimeNl(row.start_at)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-ink">
                                {row.klant_naam}
                              </p>
                              <p className="mt-0.5 truncate text-xs text-muted">
                                {row.adviseur_naam}
                              </p>
                            </div>
                            {ready ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                                <MicIcon size={12} />
                                Geüpload
                              </span>
                            ) : busy ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-orange px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                                Bezig…
                              </span>
                            ) : failed ? (
                              <span className="inline-flex shrink-0 rounded-full bg-[#C45A12] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                                Fout
                              </span>
                            ) : (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-muted">
                                <MicIcon size={12} />
                                Geen
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Rechts: upload altijd sticky zichtbaar */}
        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-white">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
              <MicIcon size={28} className="text-muted" />
              <p className="font-display text-lg font-semibold text-ink">
                Kies links een huisbezoek
              </p>
              <p className="max-w-sm text-sm text-muted">
                Daarna zie je hier direct de uploadknop — zonder te scrollen.
              </p>
            </div>
          ) : (
            <>
              {/* Sticky header met altijd zichtbare upload */}
              <div className="shrink-0 border-b border-line bg-white px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-xl font-semibold text-ink">
                      {selected.klant_naam}
                    </p>
                    <p className="mt-0.5 text-sm text-muted">
                      {formatTimeNl(selected.start_at)} · {selected.adviseur_naam}
                    </p>
                    {selected.voice_note?.status === "ready" ? (
                      <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-green-soft px-2.5 py-1 text-[11px] font-semibold text-green-dark">
                        <MicIcon size={12} />
                        Opname aanwezig
                      </p>
                    ) : (
                      <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-wash px-2.5 py-1 text-[11px] font-semibold text-muted">
                        Nog geen opname
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={uploadingId === selected.id}
                    onClick={() => startUpload(selected.id)}
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-orange px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#e0651c] disabled:opacity-60"
                  >
                    <MicIcon size={18} />
                    {uploadingId === selected.id
                      ? "Bezig…"
                      : selected.voice_note
                        ? "Nieuwe upload"
                        : "Voice uploaden"}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  mp3 · m4a · wav · webm
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                {uploadingId === selected.id ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
                    <p className="font-semibold text-ink">
                      Uploaden &amp; transcriberen…
                    </p>
                    <p className="text-sm text-muted">
                      Sprekers worden gelabeld (adviseur / klant).
                    </p>
                  </div>
                ) : detailLoading ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted">
                    Transcript laden…
                  </div>
                ) : detailMatches ? (
                  <VoiceNoteWorkspace
                    detail={detail!}
                    onAnnotationsChange={(anns) =>
                      setDetail((d) => (d ? { ...d, annotations: anns } : d))
                    }
                    onReupload={() => startUpload(selected.id)}
                    hideUploadButton
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
                    <p className="text-sm text-muted">
                      Gebruik de oranje knop hierboven om een voice note te
                      uploaden.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function normalizeSearchText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function VoiceNoteWorkspace({
  detail,
  onAnnotationsChange,
  onReupload,
  hideUploadButton = false,
}: {
  detail: NoteDetail;
  onAnnotationsChange: (a: VoiceAnnotation[]) => void;
  onReupload: () => void;
  hideUploadButton?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [leesMee, setLeesMee] = useState(true);
  const [search, setSearch] = useState("");
  const [hitCursor, setHitCursor] = useState(0);
  const [draftNote, setDraftNote] = useState<{
    segment: VoiceTranscriptSegment;
    text: string;
  } | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [review, setReview] = useState<StraightLineReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const segments = useMemo(
    () =>
      Array.isArray(detail.note.segments)
        ? detail.note.segments
        : [],
    [detail.note.segments]
  );
  const note = detail.note;

  const activeSegId = useMemo(() => {
    if (segments.length === 0) return null;
    let containing: VoiceTranscriptSegment | null = null;
    let lastStarted: VoiceTranscriptSegment | null = null;
    for (const s of segments) {
      if (s.start <= currentTime) lastStarted = s;
      if (currentTime >= s.start && currentTime <= s.end + 0.25) {
        containing = s;
      }
    }
    return (containing || lastStarted)?.id ?? null;
  }, [segments, currentTime]);

  const hitSegments = useMemo(() => {
    const needle = normalizeSearchText(search);
    if (!needle) return [] as VoiceTranscriptSegment[];
    return segments.filter((s) =>
      normalizeSearchText(s.text).includes(needle)
    );
  }, [segments, search]);

  const searchHits = useMemo(
    () => new Set(hitSegments.map((s) => s.id)),
    [hitSegments]
  );

  const scrollSegIntoView = useCallback((segId: string, smooth = true) => {
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-seg="${segId}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({
      block: "center",
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  // Lees mee: transcript volgt de audio
  useEffect(() => {
    if (!leesMee || !playing || !activeSegId) return;
    scrollSegIntoView(activeSegId, true);
  }, [activeSegId, leesMee, playing, scrollSegIntoView]);

  // Zoeken: spring naar eerste treffer in de lijst
  useEffect(() => {
    setHitCursor(0);
    const needle = normalizeSearchText(search);
    if (!needle) return;
    const first = segments.find((s) =>
      normalizeSearchText(s.text).includes(needle)
    );
    if (first) scrollSegIntoView(first.id, true);
  }, [search, segments, scrollSegIntoView]);

  // Reset AI-review bij andere note
  useEffect(() => {
    setReview(null);
    setShowReview(false);
    setReviewError(null);
    setSearch("");
    setHitCursor(0);
  }, [note.id]);

  const seekTo = (sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, sec);
    setCurrentTime(a.currentTime);
    void a.play();
  };

  const jumpSearch = (dir: 1 | -1) => {
    if (hitSegments.length === 0) return;
    const next =
      (hitCursor + dir + hitSegments.length * 10) % hitSegments.length;
    setHitCursor(next);
    const seg = hitSegments[next];
    scrollSegIntoView(seg.id, true);
    seekTo(seg.start);
  };

  /** Coaching-tips nà het segment waar het moment valt (of er vlak voor). */
  const tipsBySegment = useMemo(() => {
    const map = new Map<string, StraightLineStapReview[]>();
    if (!review || segments.length === 0) return map;
    for (const stap of review.stappen) {
      if (stap.status === "gedaan") continue;
      if (!stap.had_moeten_zeggen && !stap.tip) continue;
      const t = stap.moment_sec ?? 0;
      // Segment dat dit moment bevat, anders het laatste segment vóór t
      let best =
        segments.find((s) => t >= s.start && t <= s.end + 0.5) || null;
      if (!best) {
        for (const s of segments) {
          if (s.start <= t) best = s;
          else break;
        }
      }
      best = best || segments[0];
      const list = map.get(best.id) || [];
      list.push(stap);
      map.set(best.id, list);
    }
    return map;
  }, [review, segments]);

  const runAiReview = async () => {
    setReviewLoading(true);
    setReviewError(null);
    setShowReview(true);
    try {
      const res = await fetch(`/api/voice-ai/notes/${note.id}/review`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI-review mislukt");
      setReview(data.review as StraightLineReview);
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : "AI-review mislukt");
    } finally {
      setReviewLoading(false);
    }
  };

  const saveAnnotation = async () => {
    if (!draftNote || !draftNote.text.trim()) return;
    setSavingNote(true);
    setNoteError(null);
    try {
      const res = await fetch(`/api/voice-ai/notes/${note.id}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segment_id: draftNote.segment.id,
          start_sec: draftNote.segment.start,
          end_sec: draftNote.segment.end,
          quote_text: draftNote.segment.text.slice(0, 400),
          notitie: draftNote.text.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      onAnnotationsChange([
        ...detail.annotations,
        { ...(data.annotation as VoiceAnnotation), created_by: null },
      ]);
      setDraftNote(null);
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSavingNote(false);
    }
  };

  const deleteAnnotation = async (id: string) => {
    const res = await fetch(`/api/voice-ai/annotations/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    onAnnotationsChange(detail.annotations.filter((a) => a.id !== id));
  };

  if (note.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-sm text-[#C45A12]">
          {note.error_message || "Transcriptie mislukt"}
        </p>
        <button
          type="button"
          onClick={onReupload}
          className="rounded-xl bg-orange px-5 py-2.5 text-sm font-semibold text-white"
        >
          Opnieuw uploaden
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden lg:flex-row">
      {/* Player + transcript */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <div className="shrink-0 border-b border-line px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">
                Transcript
                {note.duration_sec != null
                  ? ` · ${formatVoiceTime(note.duration_sec)}`
                  : ""}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Adviseur {detail.adviseur_naam} · klant {detail.klant_naam}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setLeesMee((v) => !v)}
                className={[
                  "inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold",
                  leesMee
                    ? "border-green bg-green text-white"
                    : "border-line bg-white text-ink hover:bg-wash",
                ].join(" ")}
              >
                Lees mee{leesMee ? " · aan" : ""}
              </button>
              <button
                type="button"
                onClick={() => void runAiReview()}
                disabled={reviewLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
              >
                {reviewLoading ? "AI leest…" : "AI · Lees uit"}
              </button>
              {!hideUploadButton && (
                <button
                  type="button"
                  onClick={onReupload}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2.5 text-sm font-medium text-ink hover:bg-wash"
                >
                  <MicIcon size={14} />
                  Nieuwe upload
                </button>
              )}
            </div>
          </div>

          {detail.audioUrl ? (
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-wash px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  const a = audioRef.current;
                  if (!a) return;
                  if (a.paused) void a.play();
                  else a.pause();
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green text-white"
              >
                {playing ? (
                  <span className="text-xs font-bold">❚❚</span>
                ) : (
                  <PlayIcon />
                )}
              </button>
              <audio
                ref={audioRef}
                src={detail.audioUrl}
                className="w-full"
                controls
                onTimeUpdate={() =>
                  setCurrentTime(audioRef.current?.currentTime || 0)
                }
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted">Geen audio beschikbaar</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  jumpSearch(e.shiftKey ? -1 : 1);
                }
              }}
              placeholder="Zoek woorden in het gesprek…"
              className="h-10 min-w-[180px] flex-1 border border-line px-3 text-sm outline-none focus:border-green"
            />
            <button
              type="button"
              disabled={hitSegments.length === 0}
              onClick={() => jumpSearch(-1)}
              className="h-10 border border-line px-3 text-sm font-medium disabled:opacity-40"
              title="Vorige treffer"
            >
              ←
            </button>
            <button
              type="button"
              disabled={hitSegments.length === 0}
              onClick={() => jumpSearch(1)}
              className="h-10 border border-line px-3 text-sm font-medium disabled:opacity-40"
              title="Volgende treffer"
            >
              →
            </button>
            {search.trim() ? (
              <span
                className={[
                  "text-xs font-semibold",
                  hitSegments.length > 0 ? "text-green-dark" : "text-[#C45A12]",
                ].join(" ")}
              >
                {hitSegments.length === 0
                  ? "0 treffers"
                  : `${Math.min(hitCursor + 1, hitSegments.length)}/${hitSegments.length}`}
              </span>
            ) : null}
            <span className="ml-auto text-xs tabular-nums text-muted">
              {formatVoiceTime(currentTime)}
            </span>
          </div>
        </div>

        <div
          ref={listRef}
          className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3 sm:px-4"
        >
          {segments.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-muted">
              Geen segmenten in transcript
            </p>
          ) : (
            segments.map((seg) => {
              const active = seg.id === activeSegId;
              const hit = searchHits.has(seg.id);
              const currentHit =
                hit &&
                hitSegments[hitCursor]?.id === seg.id &&
                search.trim().length > 0;
              const isAdv = seg.role === "adviseur";
              const dimForSearch =
                search.trim().length > 0 && !hit && !active;
              const tips = tipsBySegment.get(seg.id) || [];
              return (
                <div key={seg.id} data-seg={seg.id}>
                  <div
                    className={[
                      "rounded-xl px-4 py-3 transition",
                      active
                        ? "bg-orange/10 ring-2 ring-orange/50"
                        : currentHit
                          ? "bg-yellow-100 ring-2 ring-yellow-400"
                          : hit
                            ? "bg-green-soft/80"
                            : dimForSearch
                              ? "opacity-35 hover:opacity-100 hover:bg-wash"
                              : "hover:bg-wash",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      onClick={() => seekTo(seg.start)}
                      className="w-full text-left"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[11px] tabular-nums text-muted">
                          {formatVoiceTime(seg.start)}
                        </span>
                        <span
                          className={[
                            "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                            isAdv
                              ? "bg-orange/15 text-orange"
                              : "bg-[#E8F0F6] text-[#1A4A6E]",
                          ].join(" ")}
                        >
                          {seg.speakerName}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm leading-relaxed text-ink">
                        <HighlightText text={seg.text} query={search} />
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftNote({ segment: seg, text: "" })}
                      className="mt-2 text-[11px] font-semibold text-muted hover:text-orange"
                    >
                      + Notitie voor adviseur
                    </button>
                  </div>

                  {tips.map((stap) => (
                    <CoachingInsert
                      key={`${seg.id}-${stap.id}`}
                      stap={stap}
                      onSeek={() =>
                        seekTo(stap.moment_sec ?? seg.start)
                      }
                    />
                  ))}
                </div>
              );
            })
          )}
        </div>

        {(detail.annotations.length > 0 || draftNote) && (
          <div className="border-t border-line px-5 py-4 sm:px-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Coaching-notities
            </p>
            {noteError && (
              <p className="mt-2 text-xs text-[#C45A12]">{noteError}</p>
            )}
            {draftNote && (
              <div className="mt-3 rounded-xl bg-wash px-4 py-3">
                <p className="text-xs text-muted">
                  {formatVoiceTime(draftNote.segment.start)} ·{" "}
                  {draftNote.segment.speakerName}
                </p>
                <p className="mt-1 line-clamp-2 text-xs italic text-ink">
                  “{draftNote.segment.text}”
                </p>
                <textarea
                  value={draftNote.text}
                  onChange={(e) =>
                    setDraftNote({ ...draftNote, text: e.target.value })
                  }
                  rows={3}
                  placeholder="Hier had je dit moeten zeggen…"
                  className="mt-2 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={savingNote || !draftNote.text.trim()}
                    onClick={() => void saveAnnotation()}
                    className="rounded-lg bg-orange px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Opslaan
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftNote(null)}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs"
                  >
                    Annuleren
                  </button>
                </div>
              </div>
            )}
            <ul className="mt-3 space-y-2">
              {detail.annotations.map((a) => (
                <li
                  key={a.id}
                  className="rounded-xl border border-line px-4 py-3 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => seekTo(a.start_sec)}
                    className="text-[11px] font-semibold text-orange hover:underline"
                  >
                    {formatVoiceTime(a.start_sec)}
                  </button>
                  {a.quote_text && (
                    <p className="mt-1 line-clamp-2 text-xs italic text-muted">
                      “{a.quote_text}”
                    </p>
                  )}
                  <p className="mt-1.5 text-ink">{a.notitie}</p>
                  <button
                    type="button"
                    onClick={() => void deleteAnnotation(a.id)}
                    className="mt-2 text-[10px] text-muted hover:text-[#C45A12]"
                  >
                    Verwijder
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* AI review pane */}
      {showReview && (
        <aside className="flex w-full min-h-0 flex-col border-t border-line bg-white lg:w-[360px] lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">Straight Line</p>
            <button
              type="button"
              onClick={() => setShowReview(false)}
              className="text-xs text-muted hover:text-ink"
            >
              Sluiten
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {reviewLoading && (
              <p className="text-sm text-muted">AI vergelijkt met het script…</p>
            )}
            {reviewError && (
              <p className="text-sm text-[#C45A12]">{reviewError}</p>
            )}
            {review && !reviewLoading && (
              <div className="space-y-4">
                <div className="rounded-2xl bg-green-soft/50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Score
                  </p>
                  <p className="font-display text-3xl font-semibold text-green-deeper">
                    {review.score}
                    <span className="text-base text-muted">/100</span>
                  </p>
                  <p className="mt-2 text-sm text-ink">{review.samenvatting}</p>
                </div>

                {review.top_tips.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Top tips
                    </p>
                    <ul className="mt-2 space-y-2">
                      {review.top_tips.map((t, i) => (
                        <li
                          key={i}
                          className="rounded-xl border border-orange/20 bg-[#FFF0E6] px-3 py-2 text-sm text-ink"
                        >
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Stappen
                  </p>
                  <ul className="mt-2 space-y-2">
                    {review.stappen.map((s) => {
                      const alert =
                        s.kritiek &&
                        (s.status === "gemist" || s.status === "zwak");
                      return (
                        <li
                          key={s.id}
                          className={[
                            "rounded-xl border px-3 py-2.5",
                            alert
                              ? "border-[#C45A12]/40 bg-[#FFF0E6]"
                              : "border-line",
                          ].join(" ")}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p
                              className={[
                                "text-xs font-semibold",
                                alert ? "text-[#C45A12]" : "text-ink",
                              ].join(" ")}
                            >
                              {s.kritiek ? "⚠ " : ""}
                              {s.titel}
                            </p>
                            <StatusPill status={s.status} kritiek={s.kritiek} />
                          </div>
                          {s.moment_sec != null && s.status !== "gedaan" && (
                            <button
                              type="button"
                              onClick={() => {
                                const t = s.moment_sec!;
                                seekTo(t);
                                if (segments.length === 0) return;
                                const nearest = segments.reduce((best, seg) =>
                                  Math.abs(seg.start - t) <
                                  Math.abs(best.start - t)
                                    ? seg
                                    : best
                                );
                                scrollSegIntoView(nearest.id, true);
                              }}
                              className="mt-1.5 text-[11px] font-bold tabular-nums text-orange hover:underline"
                            >
                              ▶ Op {formatVoiceTime(s.moment_sec)} in het gesprek
                            </button>
                          )}
                          <p className="mt-1 text-xs text-muted">
                            {s.toelichting}
                          </p>
                          {s.had_moeten_zeggen && (
                            <p className="mt-1.5 rounded-lg bg-white/80 px-2 py-1.5 text-xs italic text-ink ring-1 ring-line">
                              “{s.had_moeten_zeggen}”
                            </p>
                          )}
                          {s.tip && !s.had_moeten_zeggen && (
                            <p
                              className={[
                                "mt-1.5 text-xs font-medium",
                                alert ? "text-[#C45A12]" : "text-orange",
                              ].join(" ")}
                            >
                              Tip: {s.tip}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function CoachingInsert({
  stap,
  onSeek,
}: {
  stap: StraightLineStapReview;
  onSeek: () => void;
}) {
  return (
    <div className="my-2 rounded-xl border border-[#C45A12]/35 bg-[#FFF0E6] px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[#C45A12] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          Had moeten zeggen
        </span>
        {stap.moment_sec != null && (
          <button
            type="button"
            onClick={onSeek}
            className="font-mono text-[11px] font-bold text-[#C45A12] hover:underline"
          >
            {formatVoiceTime(stap.moment_sec)}
          </button>
        )}
        <span className="text-[11px] font-semibold text-[#C45A12]">
          {stap.titel}
        </span>
      </div>
      <p className="mt-2 text-sm italic leading-relaxed text-ink">
        “{stap.had_moeten_zeggen || stap.tip}”
      </p>
    </div>
  );
}

function StatusPill({
  status,
  kritiek,
}: {
  status: "gedaan" | "zwak" | "gemist";
  kritiek?: boolean;
}) {
  const map = {
    gedaan: "bg-green-soft text-green-dark",
    zwak: kritiek
      ? "bg-[#C45A12] text-white"
      : "bg-[#FFF0E6] text-orange",
    gemist: "bg-[#C45A12] text-white",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${map[status]}`}
    >
      {status}
    </span>
  );
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const needle = normalizeSearchText(query);
  if (!needle) return <>{text}</>;

  // Match op genormaliseerde tekst, highlight in origineel
  const norm = normalizeSearchText(text);
  const parts: { t: string; hit: boolean }[] = [];
  let normI = 0;
  let origI = 0;

  const advanceOrig = (from: number, normCount: number): number => {
    let n = 0;
    let i = from;
    while (i < text.length && n < normCount) {
      const ch = text[i];
      const nCh = normalizeSearchText(ch);
      if (nCh.length > 0) n += nCh.length;
      i += 1;
    }
    return i;
  };

  while (normI < norm.length) {
    const at = norm.indexOf(needle, normI);
    if (at < 0) {
      parts.push({ t: text.slice(origI), hit: false });
      break;
    }
    if (at > normI) {
      const nextOrig = advanceOrig(origI, at - normI);
      parts.push({ t: text.slice(origI, nextOrig), hit: false });
      origI = nextOrig;
      normI = at;
    }
    const endOrig = advanceOrig(origI, needle.length);
    parts.push({ t: text.slice(origI, endOrig), hit: true });
    origI = endOrig;
    normI = at + needle.length;
  }

  return (
    <>
      {parts.map((p, idx) =>
        p.hit ? (
          <mark key={idx} className="rounded bg-yellow-300 px-0.5 font-semibold text-ink">
            {p.t}
          </mark>
        ) : (
          <span key={idx}>{p.t}</span>
        )
      )}
    </>
  );
}

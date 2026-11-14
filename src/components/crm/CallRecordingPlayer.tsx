"use client";

import { useState } from "react";
import { Download } from "lucide-react";

/**
 * Beluister + download UI bij elk gesprek.
 * Laadt audio pas na klik (faalt niet stil weg).
 */
export function CallRecordingPlayer({
  href,
  eventId,
  unavailable = false,
  className = "",
  fileName,
}: {
  href?: string | null;
  eventId?: string | null;
  /** Al bekend dat Unite/storage geen opname heeft — geen valse 'Terugluisteren'. */
  unavailable?: boolean;
  className?: string;
  /** Bestandsnaam bij download (zonder pad). */
  fileName?: string | null;
}) {
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "missing">(
    unavailable ? "missing" : "idle"
  );
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [blobCache, setBlobCache] = useState<Blob | null>(null);
  const [busyDownload, setBusyDownload] = useState(false);
  const [error, setError] = useState<string | null>(
    unavailable
      ? "Geen opname (niet opgenomen of verlopen in Unite)"
      : null
  );

  // eventId eerst: die route kan storage + Unite gebruiken.
  // Losse key-URL sloeg storage over → 401 van Unite.
  const streamUrl = eventId
    ? `/api/unite/recording?eventId=${encodeURIComponent(eventId)}`
    : href?.trim() || null;

  const downloadName =
    (fileName || "").trim() ||
    (eventId ? `gesprek-${eventId.slice(0, 8)}.mp3` : "gesprek-opname.mp3");

  if (!streamUrl && !unavailable) return null;
  if (unavailable && !streamUrl) {
    return (
      <div
        className={[
          "mt-2 rounded border border-line bg-wash px-2.5 py-2",
          className,
        ].join(" ")}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Opname
        </p>
        <p className="mt-0.5 text-xs text-muted">
          Geen opname (niet opgenomen of verlopen in Unite)
        </p>
      </div>
    );
  }

  async function fetchRecordingBlob(): Promise<Blob> {
    const res = await fetch(streamUrl!);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(data.error || `Opname niet beschikbaar (${res.status})`);
    }
    return res.blob();
  }

  function triggerBrowserDownload(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name.endsWith(".mp3") ? name : `${name}.mp3`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Object-URL even laten staan voor de download
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function load() {
    if (phase === "loading" || phase === "ready") return;
    setPhase("loading");
    setError(null);
    try {
      const blob = await fetchRecordingBlob();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      const url = URL.createObjectURL(blob);
      setBlobCache(blob);
      setObjectUrl(url);
      setPhase("ready");
    } catch (e) {
      setPhase("missing");
      const msg =
        e instanceof Error ? e.message : "Geen opname beschikbaar";
      setError(
        /niet opgenomen|verlopen|niet gevonden|404|user verified|401|403|auth|token|mislukt/i.test(
          msg
        )
          ? "Geen opname (niet opgenomen of verlopen in Unite)"
          : msg
      );
    }
  }

  async function download() {
    if (!streamUrl || busyDownload) return;
    setBusyDownload(true);
    setError(null);
    try {
      let blob = blobCache;
      if (!blob) {
        blob = await fetchRecordingBlob();
        setBlobCache(blob);
        if (phase !== "ready") {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          setObjectUrl(URL.createObjectURL(blob));
          setPhase("ready");
        }
      }
      triggerBrowserDownload(blob, downloadName);
    } catch (e) {
      setPhase("missing");
      const msg =
        e instanceof Error ? e.message : "Download mislukt";
      setError(
        /niet opgenomen|verlopen|niet gevonden|404|user verified|401|403|auth|token|mislukt/i.test(
          msg
        )
          ? "Geen opname (niet opgenomen of verlopen in Unite)"
          : msg
      );
    } finally {
      setBusyDownload(false);
    }
  }

  return (
    <div
      className={[
        "mt-2 rounded border border-line bg-wash px-2.5 py-2",
        className,
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-white text-green-dark"
          aria-hidden
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 5 6 9H2v6h4l5 4V5z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Opname
          </p>
          {phase === "idle" ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={() => void load()}
                className="text-xs font-semibold text-green-deeper hover:underline"
              >
                Terugluisteren
              </button>
              <button
                type="button"
                onClick={() => void download()}
                disabled={busyDownload}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#1A4A6E] hover:underline disabled:opacity-50"
              >
                <Download className="h-3 w-3" aria-hidden />
                {busyDownload ? "Downloaden…" : "Downloaden"}
              </button>
            </div>
          ) : null}
          {phase === "loading" ? (
            <p className="mt-0.5 text-xs text-muted">Opname laden…</p>
          ) : null}
          {phase === "missing" ? (
            <div className="mt-0.5">
              <p className="text-xs text-muted">
                {error || "Geen opname beschikbaar voor dit gesprek"}
              </p>
              {streamUrl ? (
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-1 text-xs font-semibold text-green-deeper hover:underline"
                >
                  Opnieuw proberen
                </button>
              ) : null}
            </div>
          ) : null}
          {phase === "ready" ? (
            <button
              type="button"
              onClick={() => void download()}
              disabled={busyDownload}
              className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-[#1A4A6E] hover:underline disabled:opacity-50"
            >
              <Download className="h-3 w-3" aria-hidden />
              {busyDownload ? "Downloaden…" : "Downloaden (.mp3)"}
            </button>
          ) : null}
        </div>
      </div>
      {phase === "ready" && objectUrl ? (
        <audio
          controls
          autoPlay
          src={objectUrl}
          className="mt-2 h-9 w-full max-w-md"
        />
      ) : null}
    </div>
  );
}

export function recordingHrefFromMeta(meta: {
  callrecordkey?: string | null;
  extension_id?: string | null;
} | null): string | null {
  const key = meta?.callrecordkey?.trim();
  if (!key) return null;
  const ext = meta?.extension_id?.trim();
  return `/api/unite/recording?key=${encodeURIComponent(key)}${
    ext ? `&extensionid=${encodeURIComponent(ext)}` : ""
  }`;
}

const UNITE_RECORDING_RETENTION_MS = 14 * 24 * 3600_000;

/** True als we weten dat beluisteren zinloos is (niet: tijdelijk nog niet gekoppeld). */
export function recordingUnavailableFromMeta(
  meta: {
    callrecordkey?: string | null;
    recording_storage_path?: string | null;
    recording_unavailable?: boolean;
    recording_complete?: boolean;
    duration_seconds?: number | null;
    answered?: boolean;
  } | null,
  createdAt?: string | null
): boolean {
  if (!meta) return false;
  if (meta.recording_storage_path?.trim()) return false;
  if (meta.callrecordkey?.trim()) return false;

  const duration = Number(meta.duration_seconds);
  const unanswered =
    meta.answered === false ||
    (Number.isFinite(duration) && duration <= 0);
  // Niet-opgenomen gesprekken hebben nooit audio
  if (unanswered) return true;

  const ageMs = createdAt
    ? Date.now() - new Date(createdAt).getTime()
    : NaN;
  const pastRetention =
    Number.isFinite(ageMs) && ageMs > UNITE_RECORDING_RETENTION_MS;

  // Oude permanente miss-flag alleen respecteren ná retentievenster
  if (meta.recording_unavailable && pastRetention) return true;
  // Zonder key/storage: pas definitief “geen opname” ná retentie
  if (pastRetention) return true;
  return false;
}

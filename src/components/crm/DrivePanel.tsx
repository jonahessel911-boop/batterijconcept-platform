"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDateTimeNl } from "@/lib/format";
import {
  formatBytes,
  type DriveBestand,
  type DriveMap,
} from "@/lib/drive-types";

type Crumb = { id: string | null; naam: string };

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
    </svg>
  );
}

function PdfIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  );
}

export function DrivePanel() {
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, naam: "Drive" }]);
  const [mappen, setMappen] = useState<DriveMap[]>([]);
  const [bestanden, setBestanden] = useState<DriveBestand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newMapOpen, setNewMapOpen] = useState(false);
  const [newMapName, setNewMapName] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [renameTarget, setRenameTarget] = useState<
    | { kind: "map"; id: string; naam: string }
    | { kind: "bestand"; id: string; naam: string }
    | null
  >(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async (mapId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const mapQs = mapId ? `?parent_id=${encodeURIComponent(mapId)}` : "";
      const fileQs = mapId ? `?map_id=${encodeURIComponent(mapId)}` : "";
      const [mRes, fRes] = await Promise.all([
        fetch(`/api/drive/mappen${mapQs}`),
        fetch(`/api/drive/bestanden${fileQs}`),
      ]);
      const mBody = await mRes.json().catch(() => ({}));
      const fBody = await fRes.json().catch(() => ({}));
      if (!mRes.ok) throw new Error(mBody.error || "Mappen laden mislukt");
      if (!fRes.ok) throw new Error(fBody.error || "Bestanden laden mislukt");
      if (mBody.skipped || fBody.skipped) {
        setError(
          mBody.detail ||
            fBody.detail ||
            "Voer supabase/migrate-drive.sql uit in Supabase"
        );
      }
      setMappen(mBody.mappen || []);
      setBestanden(fBody.bestanden || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setMappen([]);
      setBestanden([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load(currentMapId));
    return () => cancelAnimationFrame(frame);
  }, [currentMapId, load]);

  async function openMap(map: DriveMap) {
    setCurrentMapId(map.id);
    setCrumbs((prev) => [...prev, { id: map.id, naam: map.naam }]);
  }

  async function goToCrumb(index: number) {
    const target = crumbs[index];
    if (!target) return;
    setCrumbs(crumbs.slice(0, index + 1));
    setCurrentMapId(target.id);
  }

  async function createMap() {
    const naam = newMapName.trim();
    if (!naam) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/drive/mappen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ naam, parent_id: currentMapId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Map aanmaken mislukt");
      setNewMapOpen(false);
      setNewMapName("");
      await load(currentMapId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPdf() {
    if (!currentMapId) {
      setError("Open eerst een map om een PDF te uploaden");
      return;
    }
    if (!uploadFile) {
      setError("Kies eerst een PDF");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      form.append("map_id", currentMapId);
      const naam =
        uploadName.trim() || uploadFile.name.replace(/\.pdf$/i, "") || "Document";
      form.append("naam", naam);
      const res = await fetch("/api/drive/bestanden", {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Upload mislukt");
      setUploadOpen(false);
      setUploadFile(null);
      setUploadName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load(currentMapId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function saveRename() {
    if (!renameTarget) return;
    const naam = renameValue.trim();
    if (!naam) return;
    setBusy(true);
    setError(null);
    try {
      const url =
        renameTarget.kind === "map"
          ? `/api/drive/mappen/${renameTarget.id}`
          : `/api/drive/bestanden/${renameTarget.id}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ naam }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Hernoemen mislukt");
      if (renameTarget.kind === "map") {
        setCrumbs((prev) =>
          prev.map((c) =>
            c.id === renameTarget.id ? { ...c, naam } : c
          )
        );
      }
      setRenameTarget(null);
      await load(currentMapId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMap(map: DriveMap) {
    if (
      !confirm(
        `Map “${map.naam}” verwijderen?\n\nAlle submappen en PDF’s erin verdwijnen ook.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/drive/mappen/${map.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Verwijderen mislukt");
      await load(currentMapId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  async function deleteBestand(b: DriveBestand) {
    if (!confirm(`PDF “${b.naam}” verwijderen?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/drive/bestanden/${b.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Verwijderen mislukt");
      await load(currentMapId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  const empty = !loading && mappen.length === 0 && bestanden.length === 0;

  return (
    <div className="flex h-full min-h-[60vh] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <nav className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={`${c.id || "root"}-${i}`} className="flex items-center gap-1">
                {i > 0 ? <span className="text-muted">/</span> : null}
                {last ? (
                  <span className="font-semibold text-ink">{c.naam}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void goToCrumb(i)}
                    className="font-medium text-green-dark hover:underline"
                  >
                    {c.naam}
                  </button>
                )}
              </span>
            );
          })}
        </nav>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setNewMapOpen(true);
              setNewMapName("");
            }}
            className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-60"
          >
            Nieuwe map
          </button>
          <button
            type="button"
            disabled={busy || !currentMapId}
            title={
              currentMapId
                ? "PDF uploaden in deze map"
                : "Open eerst een map om te uploaden"
            }
            onClick={() => {
              if (!currentMapId) return;
              setUploadOpen(true);
              setUploadName("");
              setUploadFile(null);
            }}
            className="bg-green px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            PDF uploaden
          </button>
        </div>
      </div>

      {error ? (
        <p className="mx-4 mt-3 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12] sm:mx-5">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="px-5 py-14 text-center text-sm text-muted">Laden…</p>
        ) : empty ? (
          <div className="px-5 py-14 text-center">
            <p className="font-display text-base font-semibold text-ink">
              Deze map is leeg
            </p>
            <p className="mt-1 text-sm text-muted">
              {currentMapId
                ? "Maak een map aan of upload een PDF."
                : "Maak een map aan en open die om PDF’s te uploaden."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {mappen.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-wash sm:px-5"
              >
                <button
                  type="button"
                  onClick={() => void openMap(m)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="text-[#CA8A04]">
                    <FolderIcon />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">
                      {m.naam}
                    </span>
                    <span className="text-[11px] text-muted">Map</span>
                  </span>
                </button>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="text-xs font-semibold text-muted hover:text-ink"
                    onClick={() => {
                      setRenameTarget({
                        kind: "map",
                        id: m.id,
                        naam: m.naam,
                      });
                      setRenameValue(m.naam);
                    }}
                  >
                    Hernoem
                  </button>
                  <button
                    type="button"
                    className="text-xs font-semibold text-[#C45A12] hover:underline"
                    onClick={() => void deleteMap(m)}
                  >
                    Verwijder
                  </button>
                </div>
              </li>
            ))}
            {bestanden.map((b) => (
              <li
                key={b.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-wash sm:px-5"
              >
                <a
                  href={b.url || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 flex-1 items-center gap-3"
                  onClick={(e) => {
                    if (!b.url) e.preventDefault();
                  }}
                >
                  <span className="text-[#B91C1C]">
                    <PdfIcon />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">
                      {b.naam}
                      <span className="text-muted">.pdf</span>
                    </span>
                    <span className="text-[11px] text-muted">
                      {formatBytes(b.grootte_bytes)}
                      {b.created_at
                        ? ` · ${formatDateTimeNl(b.created_at)}`
                        : ""}
                    </span>
                  </span>
                </a>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="text-xs font-semibold text-muted hover:text-ink"
                    onClick={() => {
                      setRenameTarget({
                        kind: "bestand",
                        id: b.id,
                        naam: b.naam,
                      });
                      setRenameValue(b.naam);
                    }}
                  >
                    Hernoem
                  </button>
                  <button
                    type="button"
                    className="text-xs font-semibold text-[#C45A12] hover:underline"
                    onClick={() => void deleteBestand(b)}
                  >
                    Verwijder
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Nieuwe map */}
      {newMapOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <div className="w-full max-w-md space-y-3 border border-line bg-white p-4 shadow-xl">
            <p className="font-display text-base font-semibold text-ink">
              Nieuwe map
            </p>
            <input
              autoFocus
              value={newMapName}
              onChange={(e) => setNewMapName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createMap();
              }}
              placeholder="Mapnaam"
              className="w-full border border-line px-3 py-2 text-sm outline-none focus:border-green"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewMapOpen(false)}
                className="px-3 py-1.5 text-sm text-muted"
              >
                Annuleren
              </button>
              <button
                type="button"
                disabled={busy || !newMapName.trim()}
                onClick={() => void createMap()}
                className="bg-green px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                Aanmaken
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Upload PDF */}
      {uploadOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <div className="w-full max-w-md space-y-3 border border-line bg-white p-4 shadow-xl">
            <p className="font-display text-base font-semibold text-ink">
              PDF uploaden
            </p>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Weergavenaam
              <input
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="Bijv. Installatiehandleiding Alpha ESS"
                className="mt-1 w-full border border-line px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
              />
            </label>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Bestand
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="mt-1 block w-full text-sm font-normal normal-case tracking-normal text-ink"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setUploadFile(f);
                  if (f && !uploadName.trim()) {
                    setUploadName(f.name.replace(/\.pdf$/i, ""));
                  }
                }}
              />
            </label>
            <p className="text-[11px] text-muted">Max. 20 MB · alleen PDF</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="px-3 py-1.5 text-sm text-muted"
              >
                Annuleren
              </button>
              <button
                type="button"
                disabled={busy || !uploadFile}
                onClick={() => void uploadPdf()}
                className="bg-green px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? "Bezig…" : "Uploaden"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Hernoemen */}
      {renameTarget ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <div className="w-full max-w-md space-y-3 border border-line bg-white p-4 shadow-xl">
            <p className="font-display text-base font-semibold text-ink">
              Hernoemen
            </p>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveRename();
              }}
              className="w-full border border-line px-3 py-2 text-sm outline-none focus:border-green"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="px-3 py-1.5 text-sm text-muted"
              >
                Annuleren
              </button>
              <button
                type="button"
                disabled={busy || !renameValue.trim()}
                onClick={() => void saveRename()}
                className="bg-green px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                Opslaan
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

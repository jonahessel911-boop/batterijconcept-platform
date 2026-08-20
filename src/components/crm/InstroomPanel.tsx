"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Sollicitatie, SollicitatieBestand, SollicitatieStatus } from "@/types/database";
import { formatDateTimeNl } from "@/lib/format";

const STATUS_OPTIONS: Array<{ value: SollicitatieStatus; label: string }> = [
  { value: "nieuw", label: "Nieuw" },
  { value: "gescreend", label: "Gescreend" },
  { value: "gesprek", label: "Gesprek" },
  { value: "aangenomen", label: "Aangenomen" },
  { value: "afgewezen", label: "Afgewezen" },
];

export function InstroomPanel() {
  const [items, setItems] = useState<Sollicitatie[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newNaam, setNewNaam] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newTelefoon, setNewTelefoon] = useState("");

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/instroom");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Instroom laden mislukt");
      const list = (data.sollicitaties || []) as Sollicitatie[];
      setItems(list);
      setSelectedId((prev) => prev || list[0]?.id || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  async function createSollicitatie() {
    if (!newNaam.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/instroom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naam: newNaam,
          email: newEmail,
          telefoon: newTelefoon,
          bron: "crm",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Aanmaken mislukt");
      setNewNaam("");
      setNewEmail("");
      setNewTelefoon("");
      await load();
      if (data.sollicitatie?.id) setSelectedId(data.sollicitatie.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aanmaken mislukt");
    } finally {
      setCreating(false);
    }
  }

  async function saveSelected(patch: Partial<Sollicitatie>) {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/instroom/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setItems((prev) =>
        prev.map((item) =>
          item.id === selected.id ? { ...item, ...(data.sollicitatie as Sollicitatie) } : item
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function uploadFile(file: File) {
    if (!selected) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/instroom/${selected.id}/files`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          [data.error || "Upload mislukt", data.detail].filter(Boolean).join(": ")
        );
      }
      const bestand = data.bestand as SollicitatieBestand;
      setItems((prev) =>
        prev.map((item) =>
          item.id === selected.id
            ? {
                ...item,
                sollicitatie_bestanden: [...(item.sollicitatie_bestanden || []), bestand],
              }
            : item
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload mislukt");
    } finally {
      setUploading(false);
    }
  }

  async function deleteFile(fileId: string) {
    if (!selected) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/instroom/${selected.id}/files?file_id=${encodeURIComponent(fileId)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      setItems((prev) =>
        prev.map((item) =>
          item.id === selected.id
            ? {
                ...item,
                sollicitatie_bestanden: (item.sollicitatie_bestanden || []).filter(
                  (file) => file.id !== fileId
                ),
              }
            : item
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  if (loading) {
    return <p className="px-6 py-14 text-center text-sm text-muted">Instroom laden…</p>;
  }

  return (
    <div className="grid gap-0 lg:grid-cols-[22rem_1fr]">
      <aside className="border-b border-line lg:border-b-0 lg:border-r">
        <div className="border-b border-line p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Nieuwe sollicitatie
          </p>
          <div className="mt-2 space-y-2">
            <input
              value={newNaam}
              onChange={(e) => setNewNaam(e.target.value)}
              placeholder="Naam"
              className="w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
            />
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="E-mail"
              className="w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
            />
            <input
              value={newTelefoon}
              onChange={(e) => setNewTelefoon(e.target.value)}
              placeholder="Telefoon"
              className="w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
            />
            <button
              type="button"
              disabled={creating || !newNaam.trim()}
              onClick={() => void createSollicitatie()}
              className="w-full bg-green px-3 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
            >
              {creating ? "Aanmaken…" : "Toevoegen"}
            </button>
          </div>
        </div>
        <ul className="max-h-[68vh] overflow-auto">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={[
                  "w-full border-b border-line px-4 py-3 text-left hover:bg-wash",
                  selectedId === item.id ? "bg-green-soft" : "bg-white",
                ].join(" ")}
              >
                <p className="text-sm font-semibold text-ink">{item.naam}</p>
                <p className="text-xs text-muted">{item.email || item.telefoon || "—"}</p>
                <p className="mt-1 text-[11px] font-medium text-green-dark">
                  {STATUS_OPTIONS.find((opt) => opt.value === item.status)?.label || item.status}
                </p>
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-4 py-6 text-sm text-muted">Nog geen sollicitaties.</li>
          )}
        </ul>
      </aside>

      <section className="p-4 sm:p-6">
        {error && (
          <div className="mb-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
            {error}
          </div>
        )}
        {!selected ? (
          <p className="text-sm text-muted">Selecteer een sollicitatie.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-2xl font-semibold text-green-deeper">
                  {selected.naam}
                </h3>
                <p className="text-sm text-muted">
                  {selected.email || "Geen e-mail"} · {selected.telefoon || "Geen telefoon"}
                </p>
                <p className="text-xs text-muted">
                  Binnengekomen: {formatDateTimeNl(selected.created_at)}
                </p>
              </div>
              <select
                value={selected.status}
                onChange={(e) =>
                  void saveSelected({ status: e.target.value as SollicitatieStatus })
                }
                disabled={saving}
                className="cursor-pointer border border-line bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-green disabled:opacity-50"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Notitie
              </p>
              <textarea
                defaultValue={selected.notitie || ""}
                key={`${selected.id}-notitie`}
                rows={6}
                onBlur={(e) => {
                  const next = e.target.value.trim() || null;
                  if ((selected.notitie || null) === next) return;
                  void saveSelected({ notitie: next });
                }}
                className="mt-2 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                placeholder="Interne notitie over deze kandidaat…"
              />
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Bestanden
                </p>
                <label className="cursor-pointer text-xs font-semibold text-green-dark hover:underline">
                  {uploading ? "Uploaden…" : "Bestand uploaden"}
                  <input
                    type="file"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadFile(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              <ul className="mt-2 divide-y divide-line border-y border-line">
                {(selected.sollicitatie_bestanden || []).map((file) => (
                  <li key={file.id} className="flex items-center justify-between gap-3 py-2">
                    <a
                      href={file.url || "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm text-green-dark hover:underline"
                    >
                      {file.bestandsnaam || "Bestand"}
                    </a>
                    <button
                      type="button"
                      onClick={() => void deleteFile(file.id)}
                      className="border border-line px-2 py-1 text-xs font-semibold text-muted hover:bg-wash"
                    >
                      Verwijderen
                    </button>
                  </li>
                ))}
                {(selected.sollicitatie_bestanden || []).length === 0 && (
                  <li className="py-3 text-sm text-muted">Nog geen bestanden.</li>
                )}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

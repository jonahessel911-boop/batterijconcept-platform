"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Sollicitatie, SollicitatieStatus } from "@/types/database";
import {
  normalizeSollicitatieStatus,
  SOLLICITATIE_STATUSES,
  SOLLICITATIE_STATUS_LABEL,
} from "@/lib/sollicitatie";

const COLUMN_ACCENT: Record<SollicitatieStatus, string> = {
  nieuw: "#1A4A6E",
  diskwalificatie: "#9B2C2C",
  gesprek_gepland: "#CA8A04",
  aangenomen: "#0D5C32",
};

function RecruitmentAddModal({
  open,
  onClose,
  onCreated,
  functieSuggestions,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (s: Sollicitatie) => void;
  functieSuggestions: string[];
}) {
  const [naam, setNaam] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [email, setEmail] = useState("");
  const [functie, setFunctie] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setNaam("");
    setTelefoon("");
    setEmail("");
    setFunctie("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!naam.trim()) {
      setError("Naam is verplicht");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/instroom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naam,
          telefoon,
          email,
          functie,
          bron: "crm",
          status: "nieuw",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Aanmaken mislukt");
      onCreated(data.sollicitatie as Sollicitatie);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aanmaken mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Sluiten"
        onClick={() => {
          reset();
          onClose();
        }}
      />
      <form
        onSubmit={submit}
        className="relative z-10 w-full max-w-md border border-line bg-white p-5 shadow-lg"
      >
        <h2 className="font-display text-lg tracking-tight text-ink">
          Kandidaat toevoegen
        </h2>
        <p className="mt-1 text-sm text-muted">Naam, telefoon, e-mail en functie.</p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Naam *</span>
            <input
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              className="w-full border border-line px-3 py-2 text-sm"
              autoFocus
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Telefoon</span>
            <input
              value={telefoon}
              onChange={(e) => setTelefoon(e.target.value)}
              className="w-full border border-line px-3 py-2 text-sm"
              inputMode="tel"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">E-mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-line px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Functie</span>
            <input
              value={functie}
              onChange={(e) => setFunctie(e.target.value)}
              list="recruitment-functies"
              placeholder="Bijv. Adviseur, Beller…"
              className="w-full border border-line px-3 py-2 text-sm"
            />
            <datalist id="recruitment-functies">
              {functieSuggestions.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
        </div>

        {error && (
          <p className="mt-3 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="border border-line px-4 py-2 text-sm text-muted hover:bg-wash"
          >
            Annuleren
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-green px-4 py-2 text-sm font-medium text-white hover:bg-green-deeper disabled:opacity-60"
          >
            {saving ? "Bezig…" : "Toevoegen"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function RecruitmentPanel() {
  const [items, setItems] = useState<Sollicitatie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [functieFilter, setFunctieFilter] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<SollicitatieStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/instroom");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      const list = ((data.sollicitaties || []) as Sollicitatie[]).map((s) => ({
        ...s,
        status: normalizeSollicitatieStatus(s.status),
      }));
      setItems(list);
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

  const functies = useMemo(() => {
    const set = new Set<string>();
    for (const s of items) {
      const f = (s.functie || "").trim();
      if (f) set.add(f);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "nl"));
  }, [items]);

  const filtered = useMemo(() => {
    if (!functieFilter) return items;
    return items.filter(
      (s) => (s.functie || "").trim().toLowerCase() === functieFilter.toLowerCase()
    );
  }, [items, functieFilter]);

  const byStatus = useMemo(() => {
    const map = new Map<SollicitatieStatus, Sollicitatie[]>();
    for (const st of SOLLICITATIE_STATUSES) map.set(st, []);
    for (const s of filtered) {
      const st = normalizeSollicitatieStatus(s.status);
      map.get(st)!.push(s);
    }
    return map;
  }, [filtered]);

  async function patchStatus(id: string, status: SollicitatieStatus) {
    setBusy(true);
    setError(null);
    const prev = items;
    setItems((list) =>
      list.map((s) => (s.id === id ? { ...s, status } : s))
    );
    try {
      const res = await fetch(`/api/instroom/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Status bijwerken mislukt");
      const updated = data.sollicitatie as Sollicitatie;
      setItems((list) =>
        list.map((s) =>
          s.id === id
            ? {
                ...s,
                ...updated,
                status: normalizeSollicitatieStatus(updated.status),
              }
            : s
        )
      );
    } catch (e) {
      setItems(prev);
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  function handleDrop(status: SollicitatieStatus) {
    if (!dragId) return;
    const item = items.find((s) => s.id === dragId);
    setDragId(null);
    setOverStatus(null);
    if (!item || normalizeSollicitatieStatus(item.status) === status) return;
    void patchStatus(item.id, status);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted">
            Functie
            <select
              value={functieFilter}
              onChange={(e) => setFunctieFilter(e.target.value)}
              className="border border-line bg-white px-2.5 py-1.5 text-sm text-ink"
            >
              <option value="">Alle functies</option>
              {functies.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs text-muted">
            {filtered.length} kandidaat{filtered.length === 1 ? "" : "en"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="bg-green px-4 py-2 text-sm font-medium text-white hover:bg-green-deeper"
        >
          + Toevoegen
        </button>
      </div>

      {error && (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Laden…</p>
      ) : (
        <div
          className="flex gap-3 overflow-x-auto pb-2"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {SOLLICITATIE_STATUSES.map((status) => {
            const column = byStatus.get(status) || [];
            const accent = COLUMN_ACCENT[status];
            const isOver = overStatus === status;
            return (
              <section
                key={status}
                className={[
                  "flex w-[260px] shrink-0 flex-col border bg-[#FAFBFA]",
                  isOver ? "border-green ring-2 ring-green/30" : "border-line",
                ].join(" ")}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverStatus(status);
                }}
                onDragLeave={() => {
                  if (overStatus === status) setOverStatus(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(status);
                }}
              >
                <header
                  className="flex items-center justify-between gap-2 border-b border-line bg-white px-3 py-2.5"
                  style={{ borderTop: `3px solid ${accent}` }}
                >
                  <h3 className="font-display text-sm tracking-tight text-ink">
                    {SOLLICITATIE_STATUS_LABEL[status]}
                  </h3>
                  <span className="text-xs tabular-nums text-muted">
                    {column.length}
                  </span>
                </header>
                <ul className="flex min-h-[180px] flex-col gap-2 p-2">
                  {column.map((s) => (
                    <li
                      key={s.id}
                      draggable={!busy}
                      onDragStart={() => setDragId(s.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStatus(null);
                      }}
                      className={[
                        "cursor-grab border border-line bg-white px-3 py-2.5 active:cursor-grabbing",
                        dragId === s.id ? "opacity-50" : "",
                      ].join(" ")}
                    >
                      <p className="text-sm font-medium text-ink">{s.naam}</p>
                      {s.functie && (
                        <p className="mt-0.5 text-xs font-medium text-green-deeper">
                          {s.functie}
                        </p>
                      )}
                      {s.telefoon && (
                        <p className="mt-1 text-xs tabular-nums text-muted">
                          {s.telefoon}
                        </p>
                      )}
                      {s.email && (
                        <p className="truncate text-xs text-muted">{s.email}</p>
                      )}
                    </li>
                  ))}
                  {column.length === 0 && (
                    <li className="px-2 py-6 text-center text-xs text-muted">
                      Leeg
                    </li>
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted">
        Sleep kaarten tussen kolommen om de status te wijzigen.
      </p>

      <RecruitmentAddModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        functieSuggestions={functies}
        onCreated={(s) => {
          setItems((prev) => [
            { ...s, status: normalizeSollicitatieStatus(s.status) },
            ...prev,
          ]);
        }}
      />
    </div>
  );
}

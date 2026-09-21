"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Sollicitatie,
  SollicitatieAfspraak,
  SollicitatieAfspraakSoort,
  SollicitatieBestand,
  SollicitatieStatus,
} from "@/types/database";
import {
  normalizeSollicitatieStatus,
  SOLLICITATIE_STATUSES,
  SOLLICITATIE_STATUS_LABEL,
} from "@/lib/sollicitatie";
import { formatDateTimeNl } from "@/lib/format";

const COLUMN_ACCENT: Record<SollicitatieStatus, string> = {
  nieuw: "#1A4A6E",
  diskwalificatie: "#9B2C2C",
  gesprek_gepland: "#CA8A04",
  aangenomen: "#0D5C32",
};

function toLocalInputValue(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

function PlanGesprekModal({
  open,
  onClose,
  kandidaten,
  defaultSollicitatieId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  kandidaten: Sollicitatie[];
  defaultSollicitatieId?: string | null;
  onCreated: (a: SollicitatieAfspraak) => void;
}) {
  const [sollicitatieId, setSollicitatieId] = useState("");
  const [soort, setSoort] = useState<SollicitatieAfspraakSoort>("telefonisch");
  const [startAt, setStartAt] = useState(toLocalInputValue());
  const [notitie, setNotitie] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSollicitatieId(defaultSollicitatieId || kandidaten[0]?.id || "");
    setSoort("telefonisch");
    setStartAt(toLocalInputValue());
    setNotitie("");
    setError(null);
  }, [open, defaultSollicitatieId, kandidaten]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sollicitatieId || !startAt) {
      setError("Kies een kandidaat en datum/tijd");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/instroom/afspraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sollicitatie_id: sollicitatieId,
          start_at: startAt,
          soort,
          notitie,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Plannen mislukt");
      onCreated(data.afspraak as SollicitatieAfspraak);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plannen mislukt");
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
        onClick={onClose}
      />
      <form
        onSubmit={submit}
        className="relative z-10 w-full max-w-md border border-line bg-white p-5 shadow-lg"
      >
        <h2 className="font-display text-lg tracking-tight text-ink">
          Gesprek plannen
        </h2>
        <p className="mt-1 text-xs text-muted">
          Alleen intern — er gaat geen e-mail naar de kandidaat.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Kandidaat *</span>
            <select
              value={sollicitatieId}
              onChange={(e) => setSollicitatieId(e.target.value)}
              className="w-full border border-line px-3 py-2 text-sm"
              required
            >
              <option value="">Kies…</option>
              {kandidaten.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.naam}
                  {k.functie ? ` · ${k.functie}` : ""}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="text-sm">
            <legend className="mb-1.5 text-muted">Type *</legend>
            <div className="flex gap-2">
              {(
                [
                  ["telefonisch", "Telefonisch"],
                  ["fysiek", "Fysiek"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSoort(value)}
                  className={[
                    "flex-1 border px-3 py-2 text-sm font-medium",
                    soort === value
                      ? "border-green bg-green/10 text-green-deeper"
                      : "border-line text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Datum & tijd *</span>
            <input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className="w-full border border-line px-3 py-2 text-sm"
              required
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Notitie</span>
            <textarea
              value={notitie}
              onChange={(e) => setNotitie(e.target.value)}
              rows={3}
              placeholder="Bijv. tweede ronde, meenemen CV…"
              className="w-full border border-line px-3 py-2 text-sm"
            />
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
            onClick={onClose}
            className="border border-line px-4 py-2 text-sm text-muted hover:bg-wash"
          >
            Annuleren
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-green px-4 py-2 text-sm font-medium text-white hover:bg-green-deeper disabled:opacity-60"
          >
            {saving ? "Bezig…" : "Inplannen"}
          </button>
        </div>
      </form>
    </div>
  );
}

function KandidaatDetail({
  kandidaat,
  afspraken,
  afsprakenLoading,
  saving,
  uploading,
  onBack,
  onSave,
  onPlan,
  onDeleteAfspraak,
  onUpload,
  onDeleteFile,
}: {
  kandidaat: Sollicitatie;
  afspraken: SollicitatieAfspraak[];
  afsprakenLoading: boolean;
  saving: boolean;
  uploading: boolean;
  onBack: () => void;
  onSave: (patch: Partial<Sollicitatie>) => Promise<void>;
  onPlan: () => void;
  onDeleteAfspraak: (id: string) => void;
  onUpload: (file: File) => void;
  onDeleteFile: (fileId: string) => void;
}) {
  const status = normalizeSollicitatieStatus(kandidaat.status);
  const bestanden = kandidaat.sollicitatie_bestanden || [];
  const now = Date.now();
  const upcoming = afspraken.filter(
    (a) => new Date(a.start_at).getTime() >= now - 60_000
  );
  const past = afspraken.filter(
    (a) => new Date(a.start_at).getTime() < now - 60_000
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 border border-line bg-white px-3 py-1.5 text-sm font-medium text-muted hover:border-green/40 hover:text-green-deeper"
        >
          ← Terug naar overzicht
        </button>
        <button
          type="button"
          onClick={onPlan}
          className="bg-green px-4 py-2 text-sm font-medium text-white hover:bg-green-deeper"
        >
          Gesprek plannen
        </button>
      </div>

      <div className="border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="font-display text-2xl tracking-tight text-ink">
              {kandidaat.naam}
            </h2>
            {kandidaat.functie && (
              <p className="mt-0.5 text-sm font-medium text-green-deeper">
                {kandidaat.functie}
              </p>
            )}
            <p className="mt-2 text-sm text-muted">
              {[kandidaat.telefoon, kandidaat.email]
                .filter(Boolean)
                .join(" · ") || "Geen contactgegevens"}
            </p>
            <p className="mt-1 text-xs text-muted">
              Binnengekomen {formatDateTimeNl(kandidaat.created_at)}
              {kandidaat.bron ? ` · via ${kandidaat.bron}` : ""}
            </p>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Status
            </span>
            <select
              value={status}
              disabled={saving}
              onChange={(e) =>
                void onSave({ status: e.target.value as SollicitatieStatus })
              }
              className="cursor-pointer border border-line bg-white px-3 py-2 text-sm font-medium outline-none focus:border-green disabled:opacity-50"
            >
              {SOLLICITATIE_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {SOLLICITATIE_STATUS_LABEL[st]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-0 lg:grid-cols-2">
          <section className="border-b border-line p-4 sm:p-6 lg:border-b-0 lg:border-r">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Notities
            </p>
            <textarea
              key={`${kandidaat.id}-notitie`}
              defaultValue={kandidaat.notitie || ""}
              rows={10}
              disabled={saving}
              onBlur={(e) => {
                const next = e.target.value.trim() || null;
                if ((kandidaat.notitie || null) === next) return;
                void onSave({ notitie: next });
              }}
              placeholder="Interne notities over deze kandidaat…"
              className="mt-2 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green disabled:opacity-50"
            />
            <p className="mt-1.5 text-xs text-muted">
              Wordt opgeslagen als je het veld verlaat.
            </p>
          </section>

          <section className="p-4 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Afspraken
              </p>
              <button
                type="button"
                onClick={onPlan}
                className="text-xs font-medium text-green-deeper hover:underline"
              >
                + Plannen
              </button>
            </div>

            {afsprakenLoading ? (
              <p className="mt-3 text-sm text-muted">Afspraken laden…</p>
            ) : afspraken.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                Nog geen gesprekken gepland met deze kandidaat.
              </p>
            ) : (
              <div className="mt-3 space-y-4">
                {upcoming.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-ink">
                      Gepland
                    </p>
                    <ul className="divide-y divide-line border border-line">
                      {upcoming.map((a) => (
                        <li
                          key={a.id}
                          className="flex items-start justify-between gap-3 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink">
                              {formatDateTimeNl(a.start_at)}
                              <span className="ml-2 inline-block border border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                                {a.soort === "fysiek"
                                  ? "Fysiek"
                                  : "Telefonisch"}
                              </span>
                            </p>
                            {a.notitie && (
                              <p className="mt-1 whitespace-pre-wrap text-xs text-muted">
                                {a.notitie}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => onDeleteAfspraak(a.id)}
                            className="shrink-0 text-xs text-[#9B2C2C] hover:underline"
                          >
                            Verwijderen
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {past.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted">
                      Eerder
                    </p>
                    <ul className="divide-y divide-line border border-line">
                      {past.map((a) => (
                        <li
                          key={a.id}
                          className="flex items-start justify-between gap-3 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-ink">
                              {formatDateTimeNl(a.start_at)}
                              <span className="ml-2 inline-block border border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                                {a.soort === "fysiek"
                                  ? "Fysiek"
                                  : "Telefonisch"}
                              </span>
                            </p>
                            {a.notitie && (
                              <p className="mt-1 whitespace-pre-wrap text-xs text-muted">
                                {a.notitie}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => onDeleteAfspraak(a.id)}
                            className="shrink-0 text-xs text-[#9B2C2C] hover:underline"
                          >
                            Verwijderen
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <section className="border-t border-line p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Bestanden
            </p>
            <label className="cursor-pointer text-xs font-medium text-green-deeper hover:underline">
              {uploading ? "Uploaden…" : "Bestand uploaden"}
              <input
                type="file"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <ul className="mt-2 divide-y divide-line border border-line">
            {bestanden.map((file) => (
              <li
                key={file.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <a
                  href={file.url || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm text-green-deeper hover:underline"
                >
                  {file.bestandsnaam || "Bestand"}
                </a>
                <button
                  type="button"
                  onClick={() => onDeleteFile(file.id)}
                  className="shrink-0 border border-line px-2 py-1 text-xs text-muted hover:bg-wash"
                >
                  Verwijderen
                </button>
              </li>
            ))}
            {bestanden.length === 0 && (
              <li className="px-3 py-3 text-sm text-muted">
                Nog geen bestanden.
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function RecruitmentPanel() {
  const [view, setView] = useState<"kanban" | "agenda">("kanban");
  const [items, setItems] = useState<Sollicitatie[]>([]);
  const [afspraken, setAfspraken] = useState<SollicitatieAfspraak[]>([]);
  const [detailAfspraken, setDetailAfspraken] = useState<SollicitatieAfspraak[]>(
    []
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [detailAfsprakenLoading, setDetailAfsprakenLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [functieFilter, setFunctieFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planForId, setPlanForId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<SollicitatieStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const draggedRef = useRef(false);

  const selected = useMemo(
    () => items.find((s) => s.id === selectedId) || null,
    [items, selectedId]
  );

  const loadKandidaten = useCallback(async () => {
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

  const loadAgenda = useCallback(async () => {
    setAgendaLoading(true);
    setError(null);
    try {
      const from = new Date();
      from.setDate(from.getDate() - 7);
      const res = await fetch(
        `/api/instroom/afspraken?from=${encodeURIComponent(from.toISOString())}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Agenda laden mislukt");
      setAfspraken((data.afspraken || []) as SollicitatieAfspraak[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agenda laden mislukt");
    } finally {
      setAgendaLoading(false);
    }
  }, []);

  const loadDetailAfspraken = useCallback(async (sollicitatieId: string) => {
    setDetailAfsprakenLoading(true);
    try {
      const res = await fetch(
        `/api/instroom/afspraken?sollicitatie_id=${encodeURIComponent(sollicitatieId)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Afspraken laden mislukt");
      setDetailAfspraken((data.afspraken || []) as SollicitatieAfspraak[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Afspraken laden mislukt");
      setDetailAfspraken([]);
    } finally {
      setDetailAfsprakenLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadKandidaten());
    return () => cancelAnimationFrame(frame);
  }, [loadKandidaten]);

  useEffect(() => {
    if (view === "agenda" && !selectedId) void loadAgenda();
  }, [view, loadAgenda, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDetailAfspraken([]);
      return;
    }
    void loadDetailAfspraken(selectedId);
  }, [selectedId, loadDetailAfspraken]);

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
      (s) =>
        (s.functie || "").trim().toLowerCase() === functieFilter.toLowerCase()
    );
  }, [items, functieFilter]);

  const byStatus = useMemo(() => {
    const map = new Map<SollicitatieStatus, Sollicitatie[]>();
    for (const st of SOLLICITATIE_STATUSES) map.set(st, []);
    for (const s of filtered) {
      map.get(normalizeSollicitatieStatus(s.status))!.push(s);
    }
    return map;
  }, [filtered]);

  async function patchKandidaat(id: string, patch: Partial<Sollicitatie>) {
    setSaving(true);
    setBusy(true);
    setError(null);
    const prev = items;
    setItems((list) =>
      list.map((s) =>
        s.id === id
          ? {
              ...s,
              ...patch,
              status: patch.status
                ? normalizeSollicitatieStatus(patch.status)
                : s.status,
            }
          : s
      )
    );
    try {
      const res = await fetch(`/api/instroom/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      const updated = data.sollicitatie as Sollicitatie;
      setItems((list) =>
        list.map((s) =>
          s.id === id
            ? {
                ...s,
                ...updated,
                status: normalizeSollicitatieStatus(updated.status),
                sollicitatie_bestanden: s.sollicitatie_bestanden,
              }
            : s
        )
      );
    } catch (e) {
      setItems(prev);
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setSaving(false);
      setBusy(false);
    }
  }

  function handleDrop(status: SollicitatieStatus) {
    if (!dragId) return;
    const item = items.find((s) => s.id === dragId);
    setDragId(null);
    setOverStatus(null);
    if (!item || normalizeSollicitatieStatus(item.status) === status) return;
    void patchKandidaat(item.id, { status });
  }

  async function deleteAfspraak(id: string) {
    if (!window.confirm("Dit gesprek uit de agenda verwijderen?")) return;
    try {
      const res = await fetch(`/api/instroom/afspraken/${id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      setAfspraken((list) => list.filter((a) => a.id !== id));
      setDetailAfspraken((list) => list.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  async function uploadFile(file: File) {
    if (!selectedId) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/instroom/${selectedId}/files`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          [data.error || "Upload mislukt", data.detail]
            .filter(Boolean)
            .join(": ")
        );
      }
      const bestand = data.bestand as SollicitatieBestand;
      setItems((prev) =>
        prev.map((item) =>
          item.id === selectedId
            ? {
                ...item,
                sollicitatie_bestanden: [
                  ...(item.sollicitatie_bestanden || []),
                  bestand,
                ],
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
    if (!selectedId) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/instroom/${selectedId}/files?file_id=${encodeURIComponent(fileId)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      setItems((prev) =>
        prev.map((item) =>
          item.id === selectedId
            ? {
                ...item,
                sollicitatie_bestanden: (
                  item.sollicitatie_bestanden || []
                ).filter((file) => file.id !== fileId),
              }
            : item
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  function openPlan(sollicitatieId?: string) {
    setPlanForId(sollicitatieId || selectedId || null);
    setPlanOpen(true);
  }

  function openKandidaat(id: string) {
    setSelectedId(id);
  }

  if (selected) {
    return (
      <div className="flex flex-col gap-4">
        {error && (
          <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
            {error}
          </p>
        )}
        <KandidaatDetail
          kandidaat={selected}
          afspraken={detailAfspraken}
          afsprakenLoading={detailAfsprakenLoading}
          saving={saving}
          uploading={uploading}
          onBack={() => setSelectedId(null)}
          onSave={(patch) => patchKandidaat(selected.id, patch)}
          onPlan={() => openPlan(selected.id)}
          onDeleteAfspraak={(id) => void deleteAfspraak(id)}
          onUpload={(file) => void uploadFile(file)}
          onDeleteFile={(fileId) => void deleteFile(fileId)}
        />
        <PlanGesprekModal
          open={planOpen}
          onClose={() => setPlanOpen(false)}
          kandidaten={items}
          defaultSollicitatieId={planForId}
          onCreated={(a) => {
            setDetailAfspraken((prev) =>
              [...prev, a].sort(
                (x, y) =>
                  new Date(x.start_at).getTime() -
                  new Date(y.start_at).getTime()
              )
            );
            setAfspraken((prev) =>
              [...prev, a].sort(
                (x, y) =>
                  new Date(x.start_at).getTime() -
                  new Date(y.start_at).getTime()
              )
            );
            const sid = a.sollicitatie_id;
            setItems((prev) =>
              prev.map((s) =>
                s.id === sid &&
                s.status !== "aangenomen" &&
                s.status !== "diskwalificatie"
                  ? { ...s, status: "gesprek_gepland" }
                  : s
              )
            );
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-line">
            {(
              [
                ["kanban", "Kanban"],
                ["agenda", "Agenda"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={[
                  "px-3 py-1.5 text-sm font-medium",
                  view === id
                    ? "bg-green text-white"
                    : "bg-white text-muted hover:bg-wash",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>

          {view === "kanban" && (
            <>
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
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openPlan()}
            className="border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-wash"
          >
            Gesprek plannen
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="bg-green px-4 py-2 text-sm font-medium text-white hover:bg-green-deeper"
          >
            + Kandidaat
          </button>
        </div>
      </div>

      {error && (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      )}

      {view === "kanban" &&
        (loading ? (
          <p className="text-sm text-muted">Laden…</p>
        ) : (
          <>
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
                      isOver
                        ? "border-green ring-2 ring-green/30"
                        : "border-line",
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
                          onDragStart={() => {
                            draggedRef.current = false;
                            setDragId(s.id);
                          }}
                          onDrag={() => {
                            draggedRef.current = true;
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setOverStatus(null);
                          }}
                          onClick={() => {
                            if (draggedRef.current) return;
                            openKandidaat(s.id);
                          }}
                          className={[
                            "cursor-pointer border border-line bg-white px-3 py-2.5 hover:border-green/40",
                            dragId === s.id ? "opacity-50" : "",
                          ].join(" ")}
                        >
                          <p className="cursor-grab text-sm font-medium text-ink active:cursor-grabbing">
                            {s.naam}
                          </p>
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
                            <p className="truncate text-xs text-muted">
                              {s.email}
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openPlan(s.id);
                            }}
                            className="mt-2 text-xs font-medium text-green-deeper hover:underline"
                          >
                            Gesprek plannen
                          </button>
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
            <p className="text-xs text-muted">
              Klik op een kandidaat voor details · sleep tussen kolommen ·
              gesprekken zijn alleen intern (geen mail).
            </p>
          </>
        ))}

      {view === "agenda" &&
        (agendaLoading ? (
          <p className="text-sm text-muted">Agenda laden…</p>
        ) : afspraken.length === 0 ? (
          <div className="border border-line bg-wash px-4 py-8 text-center">
            <p className="text-sm text-muted">Nog geen gesprekken gepland.</p>
            <button
              type="button"
              onClick={() => openPlan()}
              className="mt-3 text-sm font-medium text-green-deeper hover:underline"
            >
              Eerste gesprek plannen
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-line border border-line bg-white">
            {afspraken.map((a) => {
              const k = a.sollicitaties;
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                >
                  <button
                    type="button"
                    onClick={() => openKandidaat(a.sollicitatie_id)}
                    className="min-w-0 flex-1 text-left hover:opacity-80"
                  >
                    <p className="text-sm font-medium text-ink">
                      {formatDateTimeNl(a.start_at)}
                      <span className="ml-2 inline-block border border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        {a.soort === "fysiek" ? "Fysiek" : "Telefonisch"}
                      </span>
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-green-deeper">
                      {k?.naam || "Onbekend"}
                      {k?.functie ? (
                        <span className="font-normal text-muted">
                          {" "}
                          · {k.functie}
                        </span>
                      ) : null}
                    </p>
                    {(k?.telefoon || k?.email) && (
                      <p className="mt-0.5 text-xs text-muted">
                        {[k.telefoon, k.email].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {a.notitie && (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-muted">
                        {a.notitie}
                      </p>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteAfspraak(a.id)}
                    className="shrink-0 text-xs text-[#9B2C2C] hover:underline"
                  >
                    Verwijderen
                  </button>
                </li>
              );
            })}
          </ul>
        ))}

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

      <PlanGesprekModal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        kandidaten={items}
        defaultSollicitatieId={planForId}
        onCreated={(a) => {
          setAfspraken((prev) =>
            [...prev, a].sort(
              (x, y) =>
                new Date(x.start_at).getTime() - new Date(y.start_at).getTime()
            )
          );
          const sid = a.sollicitatie_id;
          setItems((prev) =>
            prev.map((s) =>
              s.id === sid &&
              s.status !== "aangenomen" &&
              s.status !== "diskwalificatie"
                ? { ...s, status: "gesprek_gepland" }
                : s
            )
          );
          if (view !== "agenda") setView("agenda");
        }}
      />
    </div>
  );
}

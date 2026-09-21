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

const STATUS_TONE: Record<
  SollicitatieStatus,
  { bar: string; soft: string; text: string }
> = {
  nieuw: { bar: "#1A4A6E", soft: "#E8F0F6", text: "#1A4A6E" },
  diskwalificatie: { bar: "#9B2C2C", soft: "#FCEAEA", text: "#9B2C2C" },
  gesprek_gepland: { bar: "#A16207", soft: "#FEF7E6", text: "#854D0E" },
  aangenomen: { bar: "#0D5C32", soft: "#E8F6EC", text: "#0D5C32" },
};

function initials(naam: string) {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function toLocalInputValue(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
      {children}
    </span>
  );
}

function SoftInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-green",
        props.className || "",
      ].join(" ")}
    />
  );
}

function SoftTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={[
        "w-full resize-y border border-line bg-wash/40 px-3.5 py-3 text-sm leading-relaxed text-ink outline-none transition focus:border-green focus:bg-white disabled:opacity-50",
        props.className || "",
      ].join(" ")}
    />
  );
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
        className="relative z-10 w-full max-w-md border border-line bg-white p-6 shadow-lg"
      >
        <h2 className="font-display text-xl tracking-tight text-ink">
          Kandidaat toevoegen
        </h2>
        <p className="mt-1 text-sm text-muted">
          Verschijnt direct in de kolom Nieuw.
        </p>
        <div className="mt-5 flex flex-col gap-3.5">
          <label className="block">
            <FieldLabel>Naam *</FieldLabel>
            <SoftInput
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              autoFocus
              required
            />
          </label>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <label className="block">
              <FieldLabel>Telefoon</FieldLabel>
              <SoftInput
                value={telefoon}
                onChange={(e) => setTelefoon(e.target.value)}
                inputMode="tel"
              />
            </label>
            <label className="block">
              <FieldLabel>E-mail</FieldLabel>
              <SoftInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          </div>
          <label className="block">
            <FieldLabel>Functie</FieldLabel>
            <SoftInput
              value={functie}
              onChange={(e) => setFunctie(e.target.value)}
              list="recruitment-functies"
              placeholder="Bijv. Adviseur, Beller…"
            />
            <datalist id="recruitment-functies">
              {functieSuggestions.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
        </div>
        {error && (
          <p className="mt-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-wash"
          >
            Annuleren
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-60"
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
        className="relative z-10 w-full max-w-md border border-line bg-white p-6 shadow-lg"
      >
        <h2 className="font-display text-xl tracking-tight text-ink">
          Gesprek plannen
        </h2>
        <p className="mt-1 text-sm text-muted">
          Alleen intern — er gaat geen e-mail naar de kandidaat.
        </p>

        <div className="mt-5 flex flex-col gap-3.5">
          <label className="block">
            <FieldLabel>Kandidaat *</FieldLabel>
            <select
              value={sollicitatieId}
              onChange={(e) => setSollicitatieId(e.target.value)}
              className="w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
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

          <fieldset>
            <FieldLabel>Type *</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
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
                    "border px-3 py-2.5 text-sm font-medium transition",
                    soort === value
                      ? "border-green bg-green-soft text-green-deeper"
                      : "border-line text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <FieldLabel>Datum & tijd *</FieldLabel>
            <SoftInput
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              required
            />
          </label>

          <label className="block">
            <FieldLabel>Notitie</FieldLabel>
            <SoftTextarea
              value={notitie}
              onChange={(e) => setNotitie(e.target.value)}
              rows={3}
              placeholder="Bijv. tweede ronde, meenemen CV…"
              className="bg-white"
            />
          </label>
        </div>

        {error && (
          <p className="mt-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-wash"
          >
            Annuleren
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-60"
          >
            {saving ? "Bezig…" : "Inplannen"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AfspraakRow({
  afspraak,
  muted,
  onDelete,
}: {
  afspraak: SollicitatieAfspraak;
  muted?: boolean;
  onDelete: () => void;
}) {
  return (
    <li
      className={[
        "group flex items-start justify-between gap-3 px-4 py-3.5",
        muted ? "opacity-70" : "",
      ].join(" ")}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-ink">
            {formatDateTimeNl(afspraak.start_at)}
          </p>
          <span className="border border-line bg-wash px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            {afspraak.soort === "fysiek" ? "Fysiek" : "Telefonisch"}
          </span>
        </div>
        {afspraak.notitie && (
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted">
            {afspraak.notitie}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 text-xs font-medium text-muted opacity-0 transition group-hover:opacity-100 hover:text-[#9B2C2C]"
      >
        Verwijderen
      </button>
    </li>
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
  const tone = STATUS_TONE[status];
  const bestanden = kandidaat.sollicitatie_bestanden || [];
  const now = Date.now();
  const upcoming = afspraken.filter(
    (a) => new Date(a.start_at).getTime() >= now - 60_000
  );
  const past = afspraken.filter(
    (a) => new Date(a.start_at).getTime() < now - 60_000
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <nav className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <button
          type="button"
          onClick={onBack}
          className="font-medium hover:text-green-deeper"
        >
          Recruitment
        </button>
        <span className="text-line">/</span>
        <span className="font-medium text-ink">{kandidaat.naam}</span>
      </nav>

      <section className="border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-5 border-b border-line px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex min-w-0 items-start gap-4">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center text-base font-semibold"
              style={{ background: tone.soft, color: tone.text }}
            >
              {initials(kandidaat.naam)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-display text-2xl tracking-tight text-ink sm:text-[1.75rem]">
                  {kandidaat.naam}
                </h1>
                <span
                  className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                  style={{ background: tone.soft, color: tone.text }}
                >
                  {SOLLICITATIE_STATUS_LABEL[status]}
                </span>
              </div>
              {kandidaat.functie && (
                <p className="mt-1 text-sm font-medium text-green-deeper">
                  {kandidaat.functie}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <FieldLabel>Status</FieldLabel>
              <select
                value={status}
                disabled={saving}
                onChange={(e) =>
                  void onSave({ status: e.target.value as SollicitatieStatus })
                }
                className="cursor-pointer border border-line bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-green disabled:opacity-50"
              >
                {SOLLICITATIE_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {SOLLICITATIE_STATUS_LABEL[st]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={onPlan}
              className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-deeper"
            >
              Gesprek plannen
            </button>
          </div>
        </div>

        <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-wash px-5 py-4">
            <FieldLabel>Telefoon</FieldLabel>
            {kandidaat.telefoon ? (
              <a
                href={`tel:${kandidaat.telefoon}`}
                className="block truncate text-sm font-medium text-ink hover:text-green-deeper"
              >
                {kandidaat.telefoon}
              </a>
            ) : (
              <p className="text-sm text-muted">—</p>
            )}
          </div>
          <div className="bg-wash px-5 py-4">
            <FieldLabel>E-mail</FieldLabel>
            {kandidaat.email ? (
              <a
                href={`mailto:${kandidaat.email}`}
                className="block truncate text-sm font-medium text-ink hover:text-green-deeper"
              >
                {kandidaat.email}
              </a>
            ) : (
              <p className="text-sm text-muted">—</p>
            )}
          </div>
          <div className="bg-wash px-5 py-4">
            <FieldLabel>Bron</FieldLabel>
            <p className="truncate text-sm font-medium text-ink">
              {kandidaat.bron || "—"}
            </p>
          </div>
          <div className="bg-wash px-5 py-4">
            <FieldLabel>Binnengekomen</FieldLabel>
            <p className="truncate text-sm font-medium text-ink">
              {formatDateTimeNl(kandidaat.created_at)}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-5">
        <section className="border border-line bg-white lg:col-span-3">
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="font-display text-base font-semibold text-ink">
              Notities
            </h2>
          </div>
          <div className="p-5">
            <SoftTextarea
              key={`${kandidaat.id}-notitie`}
              defaultValue={kandidaat.notitie || ""}
              rows={12}
              disabled={saving}
              onBlur={(e) => {
                const next = e.target.value.trim() || null;
                if ((kandidaat.notitie || null) === next) return;
                void onSave({ notitie: next });
              }}
              placeholder="Interne notities over deze kandidaat…"
            />
            <p className="mt-2 text-xs text-muted">
              Automatisch opgeslagen wanneer je het veld verlaat.
            </p>
          </div>
        </section>

        <section className="border border-line bg-white lg:col-span-2">
          <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
            <h2 className="font-display text-base font-semibold text-ink">
              Afspraken
            </h2>
            <button
              type="button"
              onClick={onPlan}
              className="text-xs font-semibold text-green-deeper hover:underline"
            >
              + Plannen
            </button>
          </div>

          <div className="min-h-[220px]">
            {afsprakenLoading ? (
              <p className="px-5 py-8 text-sm text-muted">Laden…</p>
            ) : afspraken.length === 0 ? (
              <div className="flex flex-col items-start gap-3 px-5 py-8">
                <p className="text-sm text-muted">
                  Nog geen gesprekken gepland.
                </p>
                <button
                  type="button"
                  onClick={onPlan}
                  className="border border-line bg-wash px-3 py-2 text-xs font-semibold text-ink hover:border-green/40"
                >
                  Eerste gesprek plannen
                </button>
              </div>
            ) : (
              <div>
                {upcoming.length > 0 && (
                  <div>
                    <p className="bg-[#fafbfa] px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Gepland
                    </p>
                    <ul className="divide-y divide-line">
                      {upcoming.map((a) => (
                        <AfspraakRow
                          key={a.id}
                          afspraak={a}
                          onDelete={() => onDeleteAfspraak(a.id)}
                        />
                      ))}
                    </ul>
                  </div>
                )}
                {past.length > 0 && (
                  <div>
                    <p className="bg-[#fafbfa] px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Eerder
                    </p>
                    <ul className="divide-y divide-line">
                      {past.map((a) => (
                        <AfspraakRow
                          key={a.id}
                          afspraak={a}
                          muted
                          onDelete={() => onDeleteAfspraak(a.id)}
                        />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 className="font-display text-base font-semibold text-ink">
            Bestanden
          </h2>
          <label className="cursor-pointer border border-line bg-wash px-3 py-1.5 text-xs font-semibold text-ink hover:border-green/40">
            {uploading ? "Uploaden…" : "Uploaden"}
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
        {bestanden.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Nog geen bestanden.</p>
        ) : (
          <ul className="divide-y divide-line">
            {bestanden.map((file) => (
              <li
                key={file.id}
                className="group flex items-center justify-between gap-3 px-5 py-3"
              >
                <a
                  href={file.url || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm font-medium text-green-deeper hover:underline"
                >
                  {file.bestandsnaam || "Bestand"}
                </a>
                <button
                  type="button"
                  onClick={() => onDeleteFile(file.id)}
                  className="shrink-0 text-xs font-medium text-muted opacity-0 transition group-hover:opacity-100 hover:text-[#9B2C2C]"
                >
                  Verwijderen
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-2 border border-line bg-white px-4 py-2.5 text-sm font-medium text-muted transition hover:border-green/40 hover:text-green-deeper"
      >
        ← Alle kandidaten
      </button>
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
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex border border-line p-0.5">
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
                  "px-3.5 py-1.5 text-sm font-medium transition",
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
              <select
                value={functieFilter}
                onChange={(e) => setFunctieFilter(e.target.value)}
                className="border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                aria-label="Filter op functie"
              >
                <option value="">Alle functies</option>
                {functies.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <span className="text-xs tabular-nums text-muted">
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
            className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-deeper"
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
          <p className="py-10 text-center text-sm text-muted">Laden…</p>
        ) : (
          <div
            className="flex gap-3 overflow-x-auto pb-1"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {SOLLICITATIE_STATUSES.map((status) => {
              const column = byStatus.get(status) || [];
              const tone = STATUS_TONE[status];
              const isOver = overStatus === status;
              return (
                <section
                  key={status}
                  className={[
                    "flex w-[280px] shrink-0 flex-col border bg-white transition",
                    isOver
                      ? "border-green ring-2 ring-green/20"
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
                    className="flex items-center justify-between gap-2 px-3.5 py-3"
                    style={{
                      borderTop: `3px solid ${tone.bar}`,
                      background: tone.soft,
                    }}
                  >
                    <h3
                      className="text-sm font-semibold tracking-tight"
                      style={{ color: tone.text }}
                    >
                      {SOLLICITATIE_STATUS_LABEL[status]}
                    </h3>
                    <span
                      className="min-w-6 rounded-sm px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums"
                      style={{ background: "white", color: tone.text }}
                    >
                      {column.length}
                    </span>
                  </header>
                  <ul className="flex min-h-[220px] flex-col gap-2 bg-[#fafbfa] p-2.5">
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
                          "group cursor-pointer border border-line bg-white p-3 transition hover:border-green/50 hover:shadow-[0_1px_0_rgba(13,92,50,0.06)]",
                          dragId === s.id ? "opacity-40" : "",
                        ].join(" ")}
                      >
                        <div className="flex items-start gap-2.5">
                          <div
                            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-[11px] font-semibold"
                            style={{
                              background: tone.soft,
                              color: tone.text,
                            }}
                          >
                            {initials(s.naam)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-ink">
                              {s.naam}
                            </p>
                            {s.functie ? (
                              <p className="mt-0.5 truncate text-xs text-green-deeper">
                                {s.functie}
                              </p>
                            ) : null}
                            <p className="mt-1.5 truncate text-xs text-muted">
                              {s.telefoon || s.email || "Geen contact"}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2.5 flex items-center justify-between border-t border-line/80 pt-2">
                          <span className="text-[11px] font-medium text-muted group-hover:text-green-deeper">
                            Openen →
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openPlan(s.id);
                            }}
                            className="text-[11px] font-semibold text-muted hover:text-green-deeper"
                          >
                            Plannen
                          </button>
                        </div>
                      </li>
                    ))}
                    {column.length === 0 && (
                      <li className="flex flex-1 items-center justify-center px-2 py-10 text-center text-xs text-muted">
                        Sleep hierheen
                      </li>
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        ))}

      {view === "agenda" &&
        (agendaLoading ? (
          <p className="py-10 text-center text-sm text-muted">Agenda laden…</p>
        ) : afspraken.length === 0 ? (
          <div className="border border-line bg-white px-6 py-14 text-center">
            <p className="font-display text-lg text-ink">Nog geen gesprekken</p>
            <p className="mt-1 text-sm text-muted">
              Plan een intern gesprek met een kandidaat.
            </p>
            <button
              type="button"
              onClick={() => openPlan()}
              className="mt-5 bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-deeper"
            >
              Gesprek plannen
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-line border border-line bg-white">
            {afspraken.map((a) => {
              const k = a.sollicitaties;
              return (
                <li
                  key={a.id}
                  className="group flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-wash/60"
                >
                  <button
                    type="button"
                    onClick={() => openKandidaat(a.sollicitatie_id)}
                    className="flex min-w-0 flex-1 items-start gap-3.5 text-left"
                  >
                    <div
                      className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center text-xs font-semibold"
                      style={{
                        background: STATUS_TONE.gesprek_gepland.soft,
                        color: STATUS_TONE.gesprek_gepland.text,
                      }}
                    >
                      {initials(k?.naam || "?")}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-ink">
                          {formatDateTimeNl(a.start_at)}
                        </p>
                        <span className="border border-line bg-wash px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          {a.soort === "fysiek" ? "Fysiek" : "Telefonisch"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-green-deeper">
                        {k?.naam || "Onbekend"}
                        {k?.functie ? (
                          <span className="text-muted"> · {k.functie}</span>
                        ) : null}
                      </p>
                      {(k?.telefoon || k?.email) && (
                        <p className="mt-0.5 text-xs text-muted">
                          {[k.telefoon, k.email].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {a.notitie && (
                        <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted">
                          {a.notitie}
                        </p>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteAfspraak(a.id)}
                    className="shrink-0 text-xs font-medium text-muted opacity-0 transition group-hover:opacity-100 hover:text-[#9B2C2C]"
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

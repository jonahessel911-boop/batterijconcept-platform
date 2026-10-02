"use client";

import { useCallback, useEffect, useState } from "react";
import type { TrainingMoment, TrainingMomentDag } from "@/types/database";
import { RECRUITMENT_TRAINING_LOCATIE } from "@/lib/sollicitatie";
import { formatDateShort } from "@/lib/format";

type DagDraft = {
  key: string;
  datum: string;
  start_tijd: string;
  eind_tijd: string;
  planning: string;
};

function emptyDag(datum = ""): DagDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    datum,
    start_tijd: "09:00",
    eind_tijd: "17:00",
    planning: "",
  };
}

function timeShort(t: string) {
  return (t || "").slice(0, 5);
}

function formatTrainingDate(date: string) {
  return formatDateShort(`${date.slice(0, 10)}T12:00:00`);
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
        "w-full resize-y border border-line bg-white px-3.5 py-3 text-sm leading-relaxed text-ink outline-none transition focus:border-green disabled:opacity-50",
        props.className || "",
      ].join(" ")}
    />
  );
}

export function TrainingMomentFormModal({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial?: TrainingMoment | null;
  onClose: () => void;
  onSaved: (t: TrainingMoment) => void;
}) {
  const [naam, setNaam] = useState("");
  const [adres, setAdres] = useState(RECRUITMENT_TRAINING_LOCATIE);
  const [inhoud, setInhoud] = useState("");
  const [dagen, setDagen] = useState<DagDraft[]>([emptyDag()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setNaam(initial.naam);
      setAdres(initial.adres || RECRUITMENT_TRAINING_LOCATIE);
      setInhoud(initial.inhoud);
      const sorted = [...(initial.dagen || [])].sort(
        (a, b) => a.dag_nummer - b.dag_nummer
      );
      setDagen(
        sorted.length
          ? sorted.map((d) => ({
              key: d.id,
              datum: d.datum.slice(0, 10),
              start_tijd: timeShort(d.start_tijd),
              eind_tijd: timeShort(d.eind_tijd),
              planning: d.planning || "",
            }))
          : [emptyDag(initial.periode_van?.slice(0, 10) || "")]
      );
    } else {
      setNaam("");
      setAdres(RECRUITMENT_TRAINING_LOCATIE);
      setInhoud("");
      setDagen([emptyDag()]);
    }
    setError(null);
  }, [open, initial]);

  if (!open) return null;

  function updateDag(key: string, patch: Partial<DagDraft>) {
    setDagen((list) =>
      list.map((d) => (d.key === key ? { ...d, ...patch } : d))
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!naam.trim()) {
      setError("Geef het trainingmoment een naam");
      return;
    }
    if (!inhoud.trim()) {
      setError("Beschrijf wat jullie tijdens de training doen");
      return;
    }
    if (dagen.length === 0) {
      setError("Voeg minstens één dag toe");
      return;
    }
    for (let i = 0; i < dagen.length; i++) {
      const d = dagen[i];
      if (!d.datum || !d.start_tijd || !d.eind_tijd) {
        setError(`Dag ${i + 1}: vul datum en tijden in`);
        return;
      }
    }

    const datums = dagen.map((d) => d.datum).sort();
    const payload = {
      naam: naam.trim(),
      adres: adres.trim() || RECRUITMENT_TRAINING_LOCATIE,
      inhoud: inhoud.trim(),
      periode_van: datums[0],
      periode_tot: datums[datums.length - 1],
      dagen: dagen.map((d) => ({
        datum: d.datum,
        start_tijd: d.start_tijd,
        eind_tijd: d.eind_tijd,
        planning: d.planning.trim(),
      })),
    };

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        initial
          ? `/api/instroom/trainingen/${initial.id}`
          : "/api/instroom/trainingen",
        {
          method: initial ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      onSaved(data.training as TrainingMoment);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opslaan mislukt");
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
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto border border-line bg-white p-6 shadow-lg"
      >
        <h2 className="font-display text-xl tracking-tight text-ink">
          {initial ? "Training bewerken" : "Trainingmoment aanmaken"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Voeg dagen toe met datum, tijden en planning per dag.
        </p>

        <div className="mt-5 flex flex-col gap-3.5">
          <label className="block">
            <FieldLabel>Naam *</FieldLabel>
            <SoftInput
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              placeholder="Bijv. Onboarding maart 2026"
              autoFocus
              required
            />
          </label>
          <label className="block">
            <FieldLabel>Adres</FieldLabel>
            <SoftInput
              value={adres}
              onChange={(e) => setAdres(e.target.value)}
            />
          </label>
          <label className="block">
            <FieldLabel>Wat gaan we doen? *</FieldLabel>
            <SoftTextarea
              value={inhoud}
              onChange={(e) => setInhoud(e.target.value)}
              rows={4}
              required
              placeholder="Productkennis, salespitch, schaduwdag, systemen…"
            />
          </label>

          <div className="border border-line">
            <div className="flex items-center justify-between border-b border-line bg-wash/60 px-3 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Dagen
              </p>
              <button
                type="button"
                onClick={() => setDagen((list) => [...list, emptyDag()])}
                className="text-xs font-semibold text-green-deeper hover:underline"
              >
                + Dag toevoegen
              </button>
            </div>
            <div className="flex flex-col gap-4 p-3">
              {dagen.map((d, idx) => (
                <div
                  key={d.key}
                  className="border border-line bg-wash/30 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-ink">
                      Dag {idx + 1}
                    </p>
                    {dagen.length > 1 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setDagen((list) =>
                            list.filter((x) => x.key !== d.key)
                          )
                        }
                        className="text-xs font-medium text-muted hover:text-[#9B2C2C]"
                      >
                        Verwijderen
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="block sm:col-span-1">
                      <FieldLabel>Datum *</FieldLabel>
                      <SoftInput
                        type="date"
                        value={d.datum}
                        onChange={(e) =>
                          updateDag(d.key, { datum: e.target.value })
                        }
                        required
                      />
                    </label>
                    <label className="block">
                      <FieldLabel>Start *</FieldLabel>
                      <SoftInput
                        type="time"
                        value={d.start_tijd}
                        onChange={(e) =>
                          updateDag(d.key, { start_tijd: e.target.value })
                        }
                        required
                      />
                    </label>
                    <label className="block">
                      <FieldLabel>Eind *</FieldLabel>
                      <SoftInput
                        type="time"
                        value={d.eind_tijd}
                        onChange={(e) =>
                          updateDag(d.key, { eind_tijd: e.target.value })
                        }
                        required
                      />
                    </label>
                  </div>
                  <label className="mt-2 block">
                    <FieldLabel>Planning die dag</FieldLabel>
                    <SoftTextarea
                      value={d.planning}
                      onChange={(e) =>
                        updateDag(d.key, { planning: e.target.value })
                      }
                      rows={3}
                      placeholder="Bijv. 09:00 intro, 11:00 productdemo…"
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
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
            {saving ? "Bezig…" : initial ? "Opslaan" : "Aanmaken"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function TrainingMomentenView({
  trainingen,
  loading,
  onRefresh,
  onCreate,
  onEdit,
  onDelete,
}: {
  trainingen: TrainingMoment[];
  loading: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onEdit: (t: TrainingMoment) => void;
  onDelete: (id: string) => void;
}) {
  if (loading) {
    return <p className="py-10 text-center text-sm text-muted">Laden…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {trainingen.length} trainingmoment
          {trainingen.length === 1 ? "" : "en"}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-wash"
          >
            Vernieuwen
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-deeper"
          >
            + Trainingmoment
          </button>
        </div>
      </div>

      {trainingen.length === 0 ? (
        <div className="border border-line bg-white px-6 py-12 text-center">
          <p className="font-display text-lg text-ink">Nog geen trainingen</p>
          <p className="mt-1 text-sm text-muted">
            Maak een trainingmoment aan met dagen, tijden en planning.
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="mt-5 bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-deeper"
          >
            Trainingmoment aanmaken
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {trainingen.map((t) => {
            const dagen = [...(t.dagen || [])].sort(
              (a, b) => a.dag_nummer - b.dag_nummer
            ) as TrainingMomentDag[];
            return (
              <li key={t.id} className="border border-line bg-white">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
                  <div className="min-w-0">
                    <h3 className="font-display text-lg text-ink">{t.naam}</h3>
                    <p className="mt-0.5 text-sm text-muted">
                      {formatTrainingDate(t.periode_van)} –{" "}
                      {formatTrainingDate(t.periode_tot)}
                      {" · "}
                      {t.adres}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onEdit(t)}
                      className="border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                    >
                      Bewerken
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(t.id)}
                      className="border border-line px-3 py-1.5 text-xs font-semibold text-[#9B2C2C] hover:bg-[#FCEAEA]"
                    >
                      Verwijderen
                    </button>
                  </div>
                </div>
                <div className="grid gap-px bg-line sm:grid-cols-2">
                  <div className="bg-white px-4 py-3 sm:px-5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Wat doen we
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                      {t.inhoud}
                    </p>
                  </div>
                  <div className="bg-white px-4 py-3 sm:px-5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Planning ({dagen.length} dag
                      {dagen.length === 1 ? "" : "en"})
                    </p>
                    <ul className="mt-2 space-y-2">
                      {dagen.map((d) => (
                        <li key={d.id} className="text-sm">
                          <p className="font-semibold text-ink">
                            Dag {d.dag_nummer} · {formatTrainingDate(d.datum)} ·{" "}
                            {timeShort(d.start_tijd)}–{timeShort(d.eind_tijd)}
                          </p>
                          {d.planning ? (
                            <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted">
                              {d.planning}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function TrainingToewijsModal({
  open,
  kandidaatNaam,
  trainingen,
  onClose,
  onConfirm,
}: {
  open: boolean;
  kandidaatNaam: string;
  trainingen: TrainingMoment[];
  onClose: () => void;
  onConfirm: (trainingMomentId: string) => Promise<void>;
}) {
  const [trainingId, setTrainingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTrainingId(trainingen[0]?.id || "");
    setError(null);
  }, [open, trainingen]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trainingId) {
      setError("Kies een trainingmoment");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(trainingId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  const selected = trainingen.find((t) => t.id === trainingId);

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
          Training plannen
        </h2>
        <p className="mt-1 text-sm text-muted">
          Voor <span className="font-medium text-ink">{kandidaatNaam}</span>:
          kies het trainingmoment. De kandidaat krijgt een bevestigingsmail.
        </p>

        {trainingen.length === 0 ? (
          <p className="mt-5 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
            Maak eerst een trainingmoment aan onder het tabblad Trainingmomenten.
          </p>
        ) : (
          <label className="mt-5 block">
            <FieldLabel>Trainingmoment *</FieldLabel>
            <select
              value={trainingId}
              onChange={(e) => setTrainingId(e.target.value)}
              className="w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
              required
            >
              {trainingen.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.naam} ({formatTrainingDate(t.periode_van)} –{" "}
                  {formatTrainingDate(t.periode_tot)})
                </option>
              ))}
            </select>
          </label>
        )}

        {selected ? (
          <div className="mt-3 border border-line bg-wash/50 px-3 py-2.5 text-xs text-muted">
            <p>
              {(selected.dagen || []).length} dag
              {(selected.dagen || []).length === 1 ? "" : "en"} · {selected.adres}
            </p>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap">
              {selected.inhoud}
            </p>
          </div>
        ) : null}

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
            disabled={saving || trainingen.length === 0}
            className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-60"
          >
            {saving ? "Bezig…" : "Inplannen + mailen"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function useTrainingMomenten() {
  const [trainingen, setTrainingen] = useState<TrainingMoment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/instroom/trainingen");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setTrainingen((data.trainingen || []) as TrainingMoment[]);
      if (data.error && !(data.trainingen || []).length) {
        setError(data.error as string);
      } else {
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  return { trainingen, setTrainingen, loading, error, setError, load };
}

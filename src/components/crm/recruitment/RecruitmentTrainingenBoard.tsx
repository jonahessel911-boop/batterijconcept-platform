"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import {
  GripVertical,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type {
  Sollicitatie,
  TrainingMoment,
  TrainingMomentDag,
} from "@/types/database";
import { normalizeSollicitatieStatus } from "@/lib/sollicitatie";
import { AMSTERDAM_TZ, formatDateShort } from "@/lib/format";
import {
  TrainingMomentFormModal,
  useTrainingMomenten,
} from "@/components/crm/TrainingMomentenPanel";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

function formatTrainingDate(date: string) {
  return formatDateShort(`${date.slice(0, 10)}T12:00:00`);
}

function timeShort(t: string) {
  return (t || "").slice(0, 5);
}

function ymdNoon(date: string) {
  return `${date.slice(0, 10)}T12:00:00`;
}

function dateParts(date: string) {
  const d = ymdNoon(date);
  return {
    weekday: formatInTimeZone(d, AMSTERDAM_TZ, "EEEE", { locale: nl }),
    day: formatInTimeZone(d, AMSTERDAM_TZ, "d", { locale: nl }),
    month: formatInTimeZone(d, AMSTERDAM_TZ, "MMM", { locale: nl }),
    full: formatInTimeZone(d, AMSTERDAM_TZ, "EEEE d MMMM yyyy", {
      locale: nl,
    }),
  };
}

function trainingDays(t: TrainingMoment): TrainingMomentDag[] {
  const dagen = [...(t.dagen || [])].sort(
    (a, b) => a.dag_nummer - b.dag_nummer
  );
  if (dagen.length) return dagen;
  // Fallback als dagen ontbreken: 1 blok uit periode_van
  return [
    {
      id: `${t.id}-fallback`,
      training_moment_id: t.id,
      dag_nummer: 1,
      datum: t.periode_van,
      start_tijd: "09:00",
      eind_tijd: "17:00",
      planning: "",
      created_at: "",
      updated_at: "",
    },
  ];
}

function initials(naam: string) {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] || ""}${parts[parts.length - 1]![0] || ""}`.toUpperCase();
}

function trainingLabel(t: TrainingMoment) {
  return `${t.naam} · ${formatTrainingDate(t.periode_van)}`;
}

export function RecruitmentTrainingenBoard({
  kandidaten,
  onKandidaatUpdated,
  onOpenKandidaat,
}: {
  kandidaten: Sollicitatie[];
  onKandidaatUpdated: (updated: Sollicitatie) => void;
  onOpenKandidaat?: (id: string) => void;
}) {
  const { trainingen, setTrainingen, loading, error, setError, load } =
    useTrainingMomenten();
  const [formOpen, setFormOpen] = useState(false);
  const [editTraining, setEditTraining] = useState<TrainingMoment | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overTrainingId, setOverTrainingId] = useState<string | null>(null);
  const [overPool, setOverPool] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function clearDrag() {
    setDragId(null);
    setOverTrainingId(null);
    setOverPool(false);
  }

  useEffect(() => {
    void load();
  }, [load]);

  const pool = useMemo(
    () =>
      kandidaten.filter(
        (k) => normalizeSollicitatieStatus(k.status) === "gesprek_gehad"
      ),
    [kandidaten]
  );

  const deelnemersByTraining = useMemo(() => {
    const map = new Map<string, Sollicitatie[]>();
    for (const k of kandidaten) {
      const tid = k.training_moment_id;
      if (!tid) continue;
      const list = map.get(tid) || [];
      list.push(k);
      map.set(tid, list);
    }
    return map;
  }, [kandidaten]);

  async function assignToTraining(sollicitatieId: string, trainingId: string) {
    const current = kandidaten.find((k) => k.id === sollicitatieId);
    if (current?.training_moment_id === trainingId) {
      clearDrag();
      return;
    }
    setBusyId(sollicitatieId);
    setActionError(null);
    try {
      const res = await fetch(`/api/instroom/${sollicitatieId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "aangenomen_training_gepland",
          training_moment_id: trainingId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Toewijzen mislukt");
      onKandidaatUpdated(data.sollicitatie as Sollicitatie);
      const moved = Boolean(current?.training_moment_id);
      const mailBit = data.mail_sent
        ? " · mail verstuurd"
        : data.mail_skipped
          ? " · geen e-mail"
          : data.mail_error
            ? ` · mailfout: ${data.mail_error}`
            : "";
      setOkMsg(
        `${moved ? "Verplaatst naar andere training" : "Op training gezet"}${mailBit}`
      );
      window.setTimeout(() => setOkMsg(null), 2800);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Toewijzen mislukt");
    } finally {
      setBusyId(null);
      clearDrag();
    }
  }

  /** Haal van training af → terug naar «Te trainen». */
  async function removeFromTraining(sollicitatieId: string) {
    const current = kandidaten.find((k) => k.id === sollicitatieId);
    if (!current?.training_moment_id) {
      clearDrag();
      return;
    }
    setBusyId(sollicitatieId);
    setActionError(null);
    try {
      const res = await fetch(`/api/instroom/${sollicitatieId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "gesprek_gehad",
          training_moment_id: null,
          notitie_append: "Training geannuleerd",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Annuleren mislukt");
      onKandidaatUpdated(data.sollicitatie as Sollicitatie);
      setOkMsg("Training geannuleerd · terug bij Te trainen");
      window.setTimeout(() => setOkMsg(null), 2800);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Annuleren mislukt");
    } finally {
      setBusyId(null);
      clearDrag();
    }
  }

  async function deleteTraining(id: string) {
    if (!window.confirm("Deze training verwijderen?")) return;
    try {
      const res = await fetch(`/api/instroom/trainingen/${id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      setTrainingen((list) => list.filter((t) => t.id !== id));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  function onDropTraining(trainingId: string) {
    if (!dragId) return;
    const kandidaat = kandidaten.find((k) => k.id === dragId);
    if (!kandidaat) {
      clearDrag();
      return;
    }
    void assignToTraining(dragId, trainingId);
  }

  function onDropPool() {
    if (!dragId) return;
    void removeFromTraining(dragId);
  }

  const draggingFromTraining = Boolean(
    dragId &&
      kandidaten.find((k) => k.id === dragId)?.training_moment_id
  );

  const flash = error || actionError || okMsg;
  const flashTone = error || actionError ? "text-destructive" : "text-green-deeper";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-3 sm:px-4">
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink">
            Trainingen
            <span className="ml-2 text-sm font-normal text-muted">
              {pool.length} te trainen
              {!loading ? ` · ${trainingen.length} gepland` : ""}
            </span>
          </p>
          {flash ? (
            <p className={cn("truncate text-sm", flashTone)}>{flash}</p>
          ) : (
            <p className="text-sm text-muted">
              Sleep tussen trainingen of terug naar Te trainen · ✕ annuleert
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 px-2.5 text-muted"
            onClick={() => void load()}
            aria-label="Vernieuwen"
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-9"
            onClick={() => {
              setEditTraining(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            Training
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* Pool — ook dropzone om training te annuleren */}
        <aside
          className={cn(
            "flex min-h-0 flex-col border-b border-line transition lg:border-b-0 lg:border-r",
            overPool && draggingFromTraining && "bg-green-soft/25"
          )}
          onDragOver={(e: DragEvent) => {
            if (!draggingFromTraining) return;
            e.preventDefault();
            setOverPool(true);
            setOverTrainingId(null);
          }}
          onDragLeave={() => setOverPool(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            onDropPool();
          }}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-wash/40 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Te trainen
            </p>
            <span className="tabular-nums text-sm font-semibold text-ink">
              {pool.length}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2.5">
            {pool.length === 0 ? (
              <p className="px-1 py-8 text-center text-sm text-muted">
                {overPool && draggingFromTraining
                  ? "Laat hier los om te annuleren"
                  : "Niemand met status «Gesprek gehad»"}
              </p>
            ) : (
              <ul className="space-y-2">
                {pool.map((k) => (
                  <li key={k.id}>
                    <div
                      draggable
                      onDragStart={() => setDragId(k.id)}
                      onDragEnd={clearDrag}
                      className={cn(
                        "rounded-lg border border-line bg-white px-2.5 py-2.5 transition",
                        dragId === k.id && "opacity-45",
                        busyId === k.id && "opacity-60"
                      )}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 text-left"
                        onClick={() => onOpenKandidaat?.(k.id)}
                      >
                        <GripVertical className="size-4 shrink-0 text-muted/70" />
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-green-soft text-xs font-semibold text-green-deeper">
                          {initials(k.naam)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold leading-tight text-ink">
                            {k.naam}
                          </span>
                          <span className="block truncate text-sm text-muted">
                            {k.functie || "—"}
                          </span>
                        </span>
                      </button>
                      {trainingen.length > 0 ? (
                        <div
                          className="mt-2"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <NativeSelect
                            value=""
                            disabled={busyId === k.id}
                            size="sm"
                            aria-label={`Training voor ${k.naam}`}
                            onChange={(e) => {
                              const tid = e.target.value;
                              if (!tid) return;
                              void assignToTraining(k.id, tid);
                            }}
                            className="w-full text-sm"
                          >
                            <NativeSelectOption value="">
                              Zet op training…
                            </NativeSelectOption>
                            {trainingen.map((t) => (
                              <NativeSelectOption key={t.id} value={t.id}>
                                {trainingLabel(t)}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Trainingen */}
        <section className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-wash/40 px-3 py-2.5 sm:px-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Geplande trainingen
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <p className="px-4 py-10 text-center text-base text-muted">
                Laden…
              </p>
            ) : trainingen.length === 0 ? (
              <div className="flex flex-col items-start gap-3 px-4 py-10">
                <p className="text-base text-muted">Nog geen trainingen.</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditTraining(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                  Eerste training maken
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {trainingen.map((t) => {
                  const deelnemers = deelnemersByTraining.get(t.id) || [];
                  const dagen = trainingDays(t);
                  const first = dagen[0]!;
                  const firstParts = dateParts(first.datum);
                  const active = overTrainingId === t.id && Boolean(dragId);
                  return (
                    <li
                      key={t.id}
                      className={cn(
                        "px-3 py-4 transition sm:px-5",
                        active && "bg-green-soft/35"
                      )}
                      onDragOver={(e: DragEvent) => {
                        e.preventDefault();
                        setOverTrainingId(t.id);
                      }}
                      onDragLeave={() => {
                        if (overTrainingId === t.id) setOverTrainingId(null);
                      }}
                      onDrop={(e: DragEvent) => {
                        e.preventDefault();
                        onDropTraining(t.id);
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <div
                            className="flex w-[4.25rem] shrink-0 flex-col items-center rounded-xl border border-line bg-white px-1.5 py-2 text-center shadow-sm"
                            title={firstParts.full}
                          >
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                              {firstParts.weekday.slice(0, 2)}
                            </span>
                            <span className="text-2xl font-bold leading-none text-ink tabular-nums">
                              {firstParts.day}
                            </span>
                            <span className="mt-0.5 text-xs font-semibold uppercase text-green-deeper">
                              {firstParts.month}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-lg font-semibold tracking-tight text-ink">
                              {t.naam}
                            </p>
                            <p className="mt-1 text-base font-semibold text-ink">
                              {firstParts.full}
                            </p>
                            <p className="mt-0.5 text-base font-medium text-green-deeper tabular-nums">
                              {timeShort(first.start_tijd)} –{" "}
                              {timeShort(first.eind_tijd)}
                              {dagen.length > 1
                                ? ` · ${dagen.length} dagen`
                                : ""}
                            </p>
                            {t.adres ? (
                              <p className="mt-1 flex items-start gap-1.5 text-sm text-muted">
                                <MapPin className="mt-0.5 size-3.5 shrink-0" />
                                <span className="min-w-0 break-words">
                                  {t.adres}
                                </span>
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-wash hover:text-ink"
                            title="Bewerken"
                            onClick={() => {
                              setEditTraining(t);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-wash hover:text-destructive"
                            title="Verwijderen"
                            onClick={() => void deleteTraining(t.id)}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>

                      {dagen.length > 1 ? (
                        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {dagen.map((d) => {
                            const p = dateParts(d.datum);
                            return (
                              <li
                                key={d.id}
                                className="rounded-lg border border-line bg-wash/40 px-3 py-2.5"
                              >
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                                  Dag {d.dag_nummer}
                                </p>
                                <p className="mt-0.5 text-[15px] font-semibold capitalize text-ink">
                                  {p.full}
                                </p>
                                <p className="mt-0.5 text-sm font-medium tabular-nums text-green-deeper">
                                  {timeShort(d.start_tijd)} –{" "}
                                  {timeShort(d.eind_tijd)}
                                </p>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}

                      <div
                        className={cn(
                          "mt-3 rounded-lg border border-dashed px-2.5 py-2.5",
                          active
                            ? "border-green bg-green-soft/50"
                            : "border-line bg-wash/30"
                        )}
                      >
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                          Deelnemers ({deelnemers.length})
                          {active ? " · laat hier los" : ""}
                        </p>
                        {deelnemers.length === 0 ? (
                          <p className="py-2 text-sm text-muted">
                            Sleep hierheen of kies links «Zet op training…»
                          </p>
                        ) : (
                          <ul className="flex flex-col gap-1.5">
                            {deelnemers.map((k) => (
                              <li key={k.id} className="min-w-0">
                                <div
                                  draggable
                                  onDragStart={() => setDragId(k.id)}
                                  onDragEnd={clearDrag}
                                  className={cn(
                                    "flex w-full max-w-full items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-2 transition hover:border-green",
                                    dragId === k.id && "opacity-45",
                                    busyId === k.id && "opacity-60"
                                  )}
                                >
                                  <GripVertical className="size-4 shrink-0 text-muted/70" />
                                  <button
                                    type="button"
                                    onClick={() => onOpenKandidaat?.(k.id)}
                                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                                    title={`Open ${k.naam}`}
                                  >
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-soft text-xs font-semibold text-green-deeper">
                                      {initials(k.naam)}
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block truncate text-[15px] font-semibold text-ink">
                                        {k.naam}
                                      </span>
                                      {k.functie ? (
                                        <span className="block truncate text-sm text-muted">
                                          {k.functie}
                                        </span>
                                      ) : null}
                                    </span>
                                  </button>
                                  {trainingen.length > 1 ? (
                                    <div
                                      className="hidden min-w-[8rem] sm:block"
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <NativeSelect
                                        value=""
                                        disabled={busyId === k.id}
                                        size="sm"
                                        aria-label={`Verplaats ${k.naam}`}
                                        onChange={(e) => {
                                          const tid = e.target.value;
                                          if (!tid) return;
                                          void assignToTraining(k.id, tid);
                                        }}
                                        className="w-full text-sm"
                                      >
                                        <NativeSelectOption value="">
                                          Verplaats…
                                        </NativeSelectOption>
                                        {trainingen
                                          .filter((x) => x.id !== t.id)
                                          .map((other) => (
                                            <NativeSelectOption
                                              key={other.id}
                                              value={other.id}
                                            >
                                              {trainingLabel(other)}
                                            </NativeSelectOption>
                                          ))}
                                      </NativeSelect>
                                    </div>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-red-50 hover:text-destructive"
                                    title="Training annuleren"
                                    disabled={busyId === k.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (
                                        !window.confirm(
                                          `${k.naam} van deze training halen?`
                                        )
                                      ) {
                                        return;
                                      }
                                      void removeFromTraining(k.id);
                                    }}
                                  >
                                    <X className="size-4" />
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      <TrainingMomentFormModal
        open={formOpen}
        initial={editTraining}
        onClose={() => {
          setFormOpen(false);
          setEditTraining(null);
        }}
        onSaved={(t) => {
          setTrainingen((list) => {
            const idx = list.findIndex((x) => x.id === t.id);
            if (idx >= 0) {
              const next = [...list];
              next[idx] = t;
              return next;
            }
            return [...list, t].sort((a, b) =>
              a.periode_van.localeCompare(b.periode_van)
            );
          });
          setError(null);
          setOkMsg(editTraining ? "Opgeslagen" : "Training aangemaakt");
          window.setTimeout(() => setOkMsg(null), 2200);
        }}
      />
    </div>
  );
}

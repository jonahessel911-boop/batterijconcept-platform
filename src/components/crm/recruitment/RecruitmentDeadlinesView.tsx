"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  ExternalLink,
  ThumbsDown,
  GraduationCap,
} from "lucide-react";
import type { SollicitatieStatus, SollicitatieTaak } from "@/types/database";
import {
  SOLLICITATIE_STATUS_LABEL,
  normalizeSollicitatieStatus,
} from "@/lib/sollicitatie";
import {
  SOLLICITATIE_TAKEL_BEOORDELEN,
  SOLLICITATIE_TAKEL_BESLISSING,
  isSollicitatieUitkomstStatus,
} from "@/lib/sollicitatie-deadlines";
import { formatDateTimeNl } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function isOverdue(dueAt: string): boolean {
  const t = new Date(dueAt).getTime();
  return Number.isFinite(t) && t < Date.now();
}

function dueTone(dueAt: string): string {
  if (isOverdue(dueAt)) return "text-[#B91C1C]";
  const hrs = (new Date(dueAt).getTime() - Date.now()) / 36e5;
  if (hrs <= 24) return "text-[#C45A12]";
  return "text-muted";
}

function isVervolgTaak(titel: string): boolean {
  return (
    titel === SOLLICITATIE_TAKEL_BEOORDELEN ||
    titel === SOLLICITATIE_TAKEL_BESLISSING ||
    titel === "Beoordeling afronden" ||
    titel === "Vervolg beoordeling" ||
    /beoordel|beslissing|vervolg/i.test(titel)
  );
}

type FilterTab = "open" | "overdue" | "beoordelen" | "beslissing";

type PendingUitkomst = {
  taak: SollicitatieTaak;
  status: SollicitatieStatus;
};

export function RecruitmentDeadlinesView({
  onOpenKandidaat,
  onSetStatus,
  onAcceptForTraining,
}: {
  onOpenKandidaat?: (id: string) => void;
  onSetStatus?: (id: string, status: SollicitatieStatus) => Promise<void>;
  /** Zet aangenomen-training (zonder moment) + ga naar Trainingen-board. */
  onAcceptForTraining?: (id: string) => Promise<void>;
}) {
  const [taken, setTaken] = useState<SollicitatieTaak[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("open");
  const [pending, setPending] = useState<PendingUitkomst | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/instroom/taken?open=1", {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Deadlines laden mislukt"
        );
      }
      setTaken((data.taken || []) as SollicitatieTaak[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () =>
      [...taken].sort(
        (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
      ),
    [taken]
  );

  const counts = useMemo(() => {
    let overdue = 0;
    let beoordelen = 0;
    let beslissing = 0;
    for (const t of taken) {
      if (isOverdue(t.due_at)) overdue += 1;
      if (
        t.titel === SOLLICITATIE_TAKEL_BEOORDELEN ||
        t.titel === "Vervolg beoordeling" ||
        t.titel === "Beoordeling afronden"
      ) {
        beoordelen += 1;
      }
      if (t.titel === SOLLICITATIE_TAKEL_BESLISSING) beslissing += 1;
    }
    return { overdue, beoordelen, beslissing, totaal: taken.length };
  }, [taken]);

  const filtered = useMemo(() => {
    if (filter === "overdue") return sorted.filter((t) => isOverdue(t.due_at));
    if (filter === "beoordelen") {
      return sorted.filter(
        (t) =>
          t.titel === SOLLICITATIE_TAKEL_BEOORDELEN ||
          t.titel === "Vervolg beoordeling" ||
          t.titel === "Beoordeling afronden"
      );
    }
    if (filter === "beslissing") {
      return sorted.filter((t) => t.titel === SOLLICITATIE_TAKEL_BESLISSING);
    }
    return sorted;
  }, [sorted, filter]);

  async function markDone(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/instroom/taken/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Afronden mislukt"
        );
      }
      setTaken((list) => list.filter((t) => t.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusyId(null);
    }
  }

  function askUitkomst(taak: SollicitatieTaak, status: SollicitatieStatus) {
    if (!taak.sollicitatie_id) return;
    setPending({ taak, status });
  }

  async function confirmPending() {
    if (!pending) return;
    const { taak, status } = pending;
    const sollicitatieId = taak.sollicitatie_id;
    if (!sollicitatieId) {
      setPending(null);
      return;
    }

    setBusyId(taak.id);
    setError(null);
    try {
      if (status === "aangenomen_training_gepland") {
        if (onAcceptForTraining) {
          await onAcceptForTraining(sollicitatieId);
        } else if (onSetStatus) {
          await onSetStatus(sollicitatieId, status);
          await load();
        }
      } else {
        if (!onSetStatus) return;
        await onSetStatus(sollicitatieId, status);
        await load();
      }
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status wijzigen mislukt");
    } finally {
      setBusyId(null);
    }
  }

  const tabs: { id: FilterTab; label: string; count: number; danger?: boolean }[] =
    [
      { id: "open", label: "Open", count: counts.totaal },
      {
        id: "overdue",
        label: "Verlopen",
        count: counts.overdue,
        danger: counts.overdue > 0,
      },
      { id: "beoordelen", label: "Beoordelen", count: counts.beoordelen },
      { id: "beslissing", label: "Beslissing", count: counts.beslissing },
    ];

  return (
    <div className="space-y-4 px-3 py-4 sm:px-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold text-ink">
            Deadlines
          </p>
          <p className="mt-0.5 text-sm text-muted">
            +1 dag beoordelen na gesprek · binnen 3 dagen beslissing
            (diskwalificatie / training / actief)
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          Vernieuwen
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={cn(
                "inline-flex items-center gap-1.5 border px-2.5 py-1 text-[12px] font-semibold transition",
                active && tab.danger
                  ? "border-[#B91C1C]/40 bg-[#FEF2F2] text-[#B91C1C]"
                  : active
                    ? "border-ink bg-ink text-white"
                    : tab.danger
                      ? "border-[#B91C1C]/30 bg-[#FEF2F2] text-[#B91C1C] hover:border-[#B91C1C]/50"
                      : "border-line bg-white text-ink hover:bg-wash"
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "tabular-nums",
                  active && !tab.danger ? "text-white/80" : "text-muted",
                  tab.danger && "text-[#B91C1C]"
                )}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted">Laden…</p>
      ) : filtered.length === 0 ? (
        <div className="border border-line bg-white px-6 py-14 text-center">
          <CalendarClock className="mx-auto size-8 text-muted" aria-hidden />
          <p className="mt-3 text-sm text-muted">Geen open deadlines</p>
        </div>
      ) : (
        <ul className="divide-y divide-line border border-line bg-white">
          {filtered.map((t) => {
            const sol = t.sollicitaties;
            const solId = t.sollicitatie_id;
            const solStatus = sol?.status
              ? normalizeSollicitatieStatus(sol.status)
              : null;
            const overdue = isOverdue(t.due_at);
            const showUitkomst =
              Boolean(onSetStatus && solId) &&
              isVervolgTaak(t.titel) &&
              (!solStatus || !isSollicitatieUitkomstStatus(solStatus));
            const busy = busyId === t.id || busyId === solId;
            return (
              <li key={t.id} className="px-3.5 py-3 sm:px-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[14px] font-semibold text-ink">
                        {sol?.naam || "Kandidaat"}
                      </p>
                      {solStatus ? (
                        <span className="text-[11px] font-medium text-muted">
                          {SOLLICITATIE_STATUS_LABEL[solStatus]}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[13px] font-medium text-ink">
                      {t.titel}
                    </p>
                    {t.notities?.trim() ? (
                      <p className="mt-1 line-clamp-2 text-[12px] text-muted">
                        {t.notities.trim()}
                      </p>
                    ) : null}
                    <p
                      className={cn(
                        "mt-1.5 text-[12px] font-semibold tabular-nums",
                        dueTone(t.due_at)
                      )}
                    >
                      {overdue ? "Verlopen · " : "Deadline · "}
                      {formatDateTimeNl(t.due_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {onOpenKandidaat ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => onOpenKandidaat(solId)}
                      >
                        <ExternalLink className="size-3.5" />
                        Open
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void markDone(t.id)}
                    >
                      <Check className="size-3.5" />
                      Klaar
                    </Button>
                  </div>
                </div>

                {showUitkomst ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
                    <p className="w-full text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Vervolg
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      className="border-[#B91C1C]/35 text-[#B91C1C] hover:bg-[#FEF2F2]"
                      onClick={() =>
                        askUitkomst(t, "gesprek_gehad_diskwalificatie")
                      }
                    >
                      <ThumbsDown className="size-3.5" />
                      Diskwalificatie
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      className="border-green/40 text-green hover:bg-green/5"
                      onClick={() =>
                        askUitkomst(t, "aangenomen_training_gepland")
                      }
                    >
                      <GraduationCap className="size-3.5" />
                      Aangenomen training
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      className="text-[12px]"
                      onClick={() => askUitkomst(t, "aangenomen_actief")}
                    >
                      Actief
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {pending ? (
        <UitkomstConfirmModal
          pending={pending}
          busy={busyId === pending.taak.id}
          onClose={() => {
            if (!busyId) setPending(null);
          }}
          onConfirm={() => void confirmPending()}
        />
      ) : null}
    </div>
  );
}

function UitkomstConfirmModal({
  pending,
  busy,
  onClose,
  onConfirm,
}: {
  pending: PendingUitkomst;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const naam = pending.taak.sollicitaties?.naam || "deze kandidaat";
  const isDisk =
    pending.status === "gesprek_gehad_diskwalificatie";
  const isTraining = pending.status === "aangenomen_training_gepland";
  const isActief = pending.status === "aangenomen_actief";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deadline-uitkomst-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md border border-line bg-white shadow-xl">
        <div className="border-b border-line px-4 py-3">
          <h2
            id="deadline-uitkomst-title"
            className="font-display text-lg font-semibold text-ink"
          >
            {isDisk
              ? "Diskwalificatie bevestigen"
              : isTraining
                ? "Aangenomen voor training?"
                : "Direct actief zetten?"}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{naam}</p>
        </div>

        <div className="space-y-3 px-4 py-4 text-sm text-ink">
          {isDisk ? (
            <p>
              Status wordt <strong>Gesprek gehad — diskwalificatie</strong>.
              Er wordt geen mail naar de sollicitant gestuurd.
            </p>
          ) : null}

          {isTraining ? (
            <>
              <p>
                Status wordt <strong>Aangenomen — training gepland</strong>{" "}
                (nog zonder trainingsmoment).
              </p>
              <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">
                <li>
                  Kandidaat verschijnt bij <strong>Trainingen → Te trainen</strong>
                </li>
                <li>Daar sleepbaar naar een concrete training</li>
                <li>
                  Planningsmail pas bij toewijzing aan een training — niet nu
                </li>
              </ul>
            </>
          ) : null}

          {isActief ? (
            <p>
              Status wordt direct <strong>Aangenomen — actief</strong> (geen
              trainingsmoment / geen trainingsmail).
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50"
          >
            Annuleren
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={cn(
              "px-3 py-2 text-sm font-semibold text-white disabled:opacity-50",
              isDisk
                ? "bg-[#B91C1C] hover:bg-[#991B1B]"
                : "bg-green hover:bg-green-deeper"
            )}
          >
            {busy
              ? "Bezig…"
              : isDisk
                ? "Diskwalificeren + mailen"
                : isTraining
                  ? "Naar Te trainen"
                  : "Zet actief"}
          </button>
        </div>
      </div>
    </div>
  );
}

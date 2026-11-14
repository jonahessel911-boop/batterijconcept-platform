"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, ExternalLink } from "lucide-react";
import type { SollicitatieStatus, SollicitatieTaak } from "@/types/database";
import {
  SOLLICITATIE_STATUS_LABEL,
  normalizeSollicitatieStatus,
} from "@/lib/sollicitatie";
import {
  SOLLICITATIE_TAKEL_BEOORDELEN,
  SOLLICITATIE_TAKEL_BESLISSING,
  SOLLICITATIE_UITKOMST_STATUSSEN,
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

export function RecruitmentDeadlinesView({
  onOpenKandidaat,
  onSetStatus,
}: {
  onOpenKandidaat?: (id: string) => void;
  onSetStatus?: (id: string, status: SollicitatieStatus) => Promise<void>;
}) {
  const [taken, setTaken] = useState<SollicitatieTaak[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      if (t.titel === SOLLICITATIE_TAKEL_BEOORDELEN) beoordelen += 1;
      if (t.titel === SOLLICITATIE_TAKEL_BESLISSING) beslissing += 1;
    }
    return { overdue, beoordelen, beslissing, totaal: taken.length };
  }, [taken]);

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

  async function setUitkomst(sollicitatieId: string, status: SollicitatieStatus) {
    // Training vereist een moment — open kandidaat i.p.v. blind zetten.
    if (status === "aangenomen_training_gepland") {
      onOpenKandidaat?.(sollicitatieId);
      return;
    }
    if (!onSetStatus) return;
    setBusyId(sollicitatieId);
    setError(null);
    try {
      await onSetStatus(sollicitatieId, status);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status wijzigen mislukt");
    } finally {
      setBusyId(null);
    }
  }

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
        <span className="inline-flex items-center gap-1.5 border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink">
          Open
          <span className="tabular-nums text-muted">{counts.totaal}</span>
        </span>
        {counts.overdue > 0 ? (
          <span className="inline-flex items-center gap-1.5 border border-[#B91C1C]/30 bg-[#FEF2F2] px-2.5 py-1 text-[12px] font-semibold text-[#B91C1C]">
            Verlopen
            <span className="tabular-nums">{counts.overdue}</span>
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5 border border-line bg-wash px-2.5 py-1 text-[12px] font-medium text-muted">
          Beoordelen {counts.beoordelen}
        </span>
        <span className="inline-flex items-center gap-1.5 border border-line bg-wash px-2.5 py-1 text-[12px] font-medium text-muted">
          Beslissing {counts.beslissing}
        </span>
      </div>

      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted">Laden…</p>
      ) : sorted.length === 0 ? (
        <div className="border border-line bg-white px-6 py-14 text-center">
          <CalendarClock className="mx-auto size-8 text-muted" aria-hidden />
          <p className="mt-3 text-sm text-muted">Geen open deadlines</p>
        </div>
      ) : (
        <ul className="divide-y divide-line border border-line bg-white">
          {sorted.map((t) => {
            const sol = t.sollicitaties;
            const solId = t.sollicitatie_id;
            const solStatus = sol?.status
              ? normalizeSollicitatieStatus(sol.status)
              : null;
            const overdue = isOverdue(t.due_at);
            const isBeslissing = t.titel === SOLLICITATIE_TAKEL_BESLISSING;
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

                {isBeslissing && onSetStatus && solId ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
                    <p className="w-full text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Zet uitkomst
                    </p>
                    {SOLLICITATIE_UITKOMST_STATUSSEN.map((st) => (
                      <Button
                        key={st}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        className="text-[12px]"
                        onClick={() => void setUitkomst(solId, st)}
                      >
                        {SOLLICITATIE_STATUS_LABEL[st]}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

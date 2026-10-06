"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectTaak } from "@/types/database";
import { formatDateTimeNl } from "@/lib/format";
import { projectStatusLabel } from "@/lib/labels";

type Filter = "alles" | "te_laat" | "komend" | "zonder_due";

function leadNaam(taak: ProjectTaak): string {
  const lead = taak.projecten?.leads;
  return lead?.naam?.trim() || "—";
}

export function ToekomstigeTakenPanel() {
  const [taken, setTaken] = useState<ProjectTaak[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("alles");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/taken?open=1&limit=1000");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setTaken((data.taken as ProjectTaak[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setTaken([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  const now = Date.now();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return taken.filter((t) => {
      const dueMs = t.due_at ? new Date(t.due_at).getTime() : null;
      const overdue = dueMs != null && dueMs < now;
      if (filter === "te_laat" && !overdue) return false;
      if (filter === "komend" && (dueMs == null || overdue)) return false;
      if (filter === "zonder_due" && dueMs != null) return false;
      if (!needle) return true;
      const hay = [
        t.titel,
        t.afdeling,
        t.notities,
        t.verantwoordelijke?.naam,
        t.aangemaakt_door?.naam,
        t.projecten?.project_nummer,
        t.projecten?.titel,
        leadNaam(t),
        t.projecten?.leads?.plaats,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [taken, filter, q, now]);

  const counts = useMemo(() => {
    let teLaat = 0;
    let komend = 0;
    let zonderDue = 0;
    for (const t of taken) {
      if (!t.due_at) {
        zonderDue += 1;
        continue;
      }
      if (new Date(t.due_at).getTime() < now) teLaat += 1;
      else komend += 1;
    }
    return {
      alles: taken.length,
      te_laat: teLaat,
      komend: komend,
      zonder_due: zonderDue,
    };
  }, [taken, now]);

  async function voltooi(taak: ProjectTaak) {
    setBusyId(taak.id);
    setError(null);
    try {
      const res = await fetch(`/api/taken/${taak.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Voltooien mislukt");
      setTaken((prev) => prev.filter((t) => t.id !== taak.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voltooien mislukt");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted">
          Alle openstaande taken (auto + handmatig), op due date
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Zoek taak, klant, project…"
            className="w-full max-w-xs border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green sm:w-72"
          />
          <button
            type="button"
            onClick={() => void load()}
            className="border border-line bg-white px-3 py-2 text-xs font-semibold text-muted hover:bg-wash"
          >
            Vernieuwen
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["alles", `Alles (${counts.alles})`],
            ["te_laat", `Te laat (${counts.te_laat})`],
            ["komend", `Komend (${counts.komend})`],
            ["zonder_due", `Zonder due (${counts.zonder_due})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={[
              "px-3 py-1.5 text-xs font-semibold",
              filter === id
                ? "bg-green text-white"
                : "border border-line bg-white text-muted hover:bg-wash",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="border border-line bg-white">
        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-muted">Laden…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            Geen openstaande taken in deze filter.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-semibold sm:px-5">Taak</th>
                  <th className="px-3 py-3 font-semibold">Afdeling</th>
                  <th className="px-3 py-3 font-semibold">Wie</th>
                  <th className="px-3 py-3 font-semibold">Due</th>
                  <th className="px-4 py-3 font-semibold sm:px-5">Actie</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((taak) => {
                  const overdue =
                    Boolean(taak.due_at) &&
                    new Date(taak.due_at!).getTime() < now;
                  const status = taak.projecten?.status
                    ? projectStatusLabel[taak.projecten.status] ||
                      taak.projecten.status
                    : null;
                  return (
                    <tr
                      key={taak.id}
                      className="border-b border-line/80 align-top last:border-b-0"
                    >
                      <td className="px-4 py-3 sm:px-5">
                        <p className="font-medium text-ink">{taak.titel}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {leadNaam(taak)}
                          {taak.projecten?.project_nummer
                            ? ` · ${taak.projecten.project_nummer}`
                            : ""}
                          {status ? ` · ${status}` : ""}
                          {taak.auto_key ? " · auto" : " · handmatig"}
                        </p>
                        {taak.notities ? (
                          <p className="mt-1 text-xs text-muted">
                            {taak.notities}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs text-muted">
                        {taak.afdeling || "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="rounded bg-[#F3F0FF] px-1.5 py-0.5 text-[10px] font-semibold text-[#5B21B6]">
                          {taak.verantwoordelijke?.naam || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs text-muted">
                        {taak.due_at ? formatDateTimeNl(taak.due_at) : "—"}
                        {overdue ? (
                          <span className="font-semibold text-[#C45A12]">
                            {" "}
                            · te laat
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 sm:px-5">
                        <div className="flex flex-wrap gap-1.5">
                          {taak.project_id ? (
                            <Link
                              href={`/projecten/${taak.project_id}?from=acties`}
                              className="min-h-8 border border-line px-2 text-[11px] font-semibold leading-8 text-ink hover:bg-wash"
                            >
                              Project
                            </Link>
                          ) : null}
                          <button
                            type="button"
                            disabled={busyId === taak.id}
                            onClick={() => void voltooi(taak)}
                            className="min-h-8 border border-line px-2 text-[11px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
                          >
                            {busyId === taak.id ? "Bezig…" : "Voltooien"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

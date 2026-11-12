"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Project } from "@/types/database";
import { formatDateShort } from "@/lib/format";
import { resolveProjectStatusLabel } from "@/lib/labels";

type InstallatieRow = Project & {
  leads?:
    | { naam?: string | null; plaats?: string | null; postcode?: string | null }
    | { naam?: string | null; plaats?: string | null; postcode?: string | null }[]
    | null;
};

type Props = {
  teamgenootId: string;
  teamgenootNaam?: string;
  teamgenootEmail?: string | null;
  teamgenootTelefoon?: string | null;
  authorNaam?: string | null;
  /** Toon header/info-blok (bij klik vanuit teamlijst). */
  showProfile?: boolean;
  onBack?: () => void;
};

function StarsCell({
  value,
  onPick,
  disabled,
}: {
  value: number | null | undefined;
  onPick: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-0.5">
      {[0, 1, 2, 3, 4, 5].map((n) => {
        if (n === 0) {
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              title="0 sterren"
              onClick={() => onPick(0)}
              className={[
                "inline-flex h-7 min-w-7 items-center justify-center border text-[11px] font-semibold disabled:opacity-50",
                value === 0
                  ? "border-line bg-wash text-ink"
                  : "border-transparent text-muted hover:border-line",
              ].join(" ")}
            >
              0
            </button>
          );
        }
        const filled = value != null && value >= n;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            title={`${n} sterren`}
            onClick={() => onPick(n)}
            className={[
              "inline-flex h-7 min-w-7 items-center justify-center text-sm leading-none disabled:opacity-50",
              filled ? "text-[#B45309]" : "text-[#D1D5DB] hover:text-[#D97706]",
            ].join(" ")}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}

export function MedewerkerInstallatiesPanel({
  teamgenootId,
  teamgenootNaam,
  teamgenootEmail,
  teamgenootTelefoon,
  authorNaam,
  showProfile = false,
  onBack,
}: Props) {
  const [items, setItems] = useState<InstallatieRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHint(null);
    try {
      const res = await fetch(
        `/api/installatie-partners/teamgenoten/${encodeURIComponent(teamgenootId)}/installaties`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      const list = (data.installaties || []) as InstallatieRow[];
      setItems(list);
      const notes: Record<string, string> = {};
      for (const r of list) {
        notes[r.id] = r.monteur_beoordeling_notitie || "";
      }
      setNoteDrafts(notes);
      if (data.hint) setHint(data.hint);
      if (data.migration_required) {
        setHint(
          data.hint ||
            "Voer migrate-project-installatie-teamgenoot.sql / migrate-monteur-beoordeling.sql uit."
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [teamgenootId]);

  useEffect(() => {
    void load();
  }, [load]);

  const afgerond = useMemo(() => {
    return items.filter((r) => {
      const s = r.status || "";
      return (
        Boolean(r.installatie_voltooid_at) ||
        s === "installatie_voltooid" ||
        s === "review_gevraagd" ||
        s === "afgerond" ||
        s === "service" ||
        Boolean(r.installatie_at)
      );
    });
  }, [items]);

  async function saveBeoordeling(
    projectId: string,
    sterren: number,
    notitie?: string
  ) {
    setBusyId(projectId);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monteur_beoordeling_sterren: sterren,
          monteur_beoordeling_notitie:
            (notitie ?? noteDrafts[projectId] ?? "").trim() || null,
          monteur_beoordeling_door: authorNaam || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      const updated = data.project as Project;
      setItems((list) =>
        list.map((r) => (r.id === projectId ? { ...r, ...updated } : r))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted">Laden…</p>;
  }

  return (
    <div className="space-y-4">
      {showProfile ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="mb-2 text-xs font-semibold text-muted hover:text-ink"
              >
                ← Terug naar team
              </button>
            ) : null}
            <h3 className="font-display text-xl font-semibold text-ink">
              {teamgenootNaam || "Medewerker"}
            </h3>
            <p className="mt-1 text-sm text-muted">
              {[teamgenootEmail, teamgenootTelefoon]
                .filter(Boolean)
                .join(" · ") || "Geen contactgegevens"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {afgerond.length} klus{afgerond.length === 1 ? "" : "sen"}
            </p>
          </div>
        </div>
      ) : (
        <div>
          <h3 className="font-display text-base font-semibold text-ink">
            Installaties
            {teamgenootNaam ? ` · ${teamgenootNaam}` : ""}
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            Afgeronde klussen met beoordeling per rij.
          </p>
        </div>
      )}

      {hint ? (
        <p className="border border-[#E8D48B] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="border border-[#C45A12]/25 bg-[#FFF7F0] px-3 py-2 text-sm text-[#9A3412]">
          {error}
        </p>
      ) : null}

      {afgerond.length === 0 ? (
        <div className="border border-line bg-white px-4 py-10 text-center">
          <p className="font-semibold text-ink">Nog geen klussen</p>
          <p className="mt-1 text-sm text-muted">
            Zodra deze medewerker op een project staat, verschijnt die hier.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-line bg-white">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-[#FAFBFA] text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                <th className="px-3 py-2.5">Project</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Datum</th>
                <th className="px-3 py-2.5">Beoordeling</th>
                <th className="px-3 py-2.5">Notitie</th>
              </tr>
            </thead>
            <tbody>
              {afgerond.map((row) => {
                const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
                const busy = busyId === row.id;
                return (
                  <tr
                    key={row.id}
                    className="border-b border-line last:border-b-0"
                  >
                    <td className="px-3 py-2.5 align-middle">
                      <Link
                        href={`/projecten/${row.id}?tab=installaties`}
                        className="font-medium text-ink hover:text-green-dark"
                      >
                        {row.project_nummer || row.id.slice(0, 8)}
                      </Link>
                      {lead?.naam ? (
                        <p className="text-xs text-muted">{lead.naam}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 align-middle text-muted">
                      {resolveProjectStatusLabel(row.status, row)}
                    </td>
                    <td className="px-3 py-2.5 align-middle text-muted">
                      {row.installatie_at
                        ? formatDateShort(row.installatie_at)
                        : row.schouw_at
                          ? formatDateShort(row.schouw_at)
                          : "—"}
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <StarsCell
                        value={row.monteur_beoordeling_sterren}
                        disabled={busy}
                        onPick={(n) =>
                          void saveBeoordeling(
                            row.id,
                            n,
                            noteDrafts[row.id]
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <div className="flex min-w-[12rem] items-center gap-2">
                        <input
                          value={noteDrafts[row.id] || ""}
                          disabled={busy}
                          onChange={(e) =>
                            setNoteDrafts((prev) => ({
                              ...prev,
                              [row.id]: e.target.value,
                            }))
                          }
                          onBlur={() => {
                            const next = (noteDrafts[row.id] || "").trim();
                            const prev = (
                              row.monteur_beoordeling_notitie || ""
                            ).trim();
                            if (next === prev) return;
                            const sterren =
                              typeof row.monteur_beoordeling_sterren ===
                              "number"
                                ? row.monteur_beoordeling_sterren
                                : 0;
                            void saveBeoordeling(row.id, sterren, next);
                          }}
                          placeholder="Notitie…"
                          className="w-full border border-line bg-white px-2 py-1.5 text-xs text-ink outline-none focus:border-green"
                        />
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
  );
}

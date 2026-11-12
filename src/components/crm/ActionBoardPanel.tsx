"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  STUUR_UNITS,
  type StuurActie,
  type StuurBoard,
  type StuurRow,
  type StuurUnitId,
} from "@/lib/stuur-board";
import { cn } from "@/lib/utils";

export function ActionBoardPanel() {
  const [unit, setUnit] = useState<StuurUnitId>("leads");
  const [board, setBoard] = useState<StuurBoard | null>(null);
  const [acties, setActies] = useState<StuurActie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftRow, setDraftRow] = useState<StuurRow | null>(null);
  const [titel, setTitel] = useState("");
  const [notitie, setNotitie] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bRes, aRes] = await Promise.all([
        fetch("/api/stuur"),
        fetch("/api/stuur/acties?open=1"),
      ]);
      const bData = await bRes.json().catch(() => ({}));
      const aData = await aRes.json().catch(() => ({}));
      if (!bRes.ok) throw new Error(bData.error || "Board laden mislukt");
      setBoard(bData.board as StuurBoard);
      setActies((aData.acties as StuurActie[]) || []);
      if (aData.hint) setError(aData.hint);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = board?.units[unit]?.rows || [];
  const unitActies = useMemo(
    () => acties.filter((a) => a.unit === unit),
    [acties, unit]
  );
  const actiesByRow = useMemo(() => {
    const map = new Map<string, StuurActie[]>();
    for (const a of unitActies) {
      const list = map.get(a.row_key) || [];
      list.push(a);
      map.set(a.row_key, list);
    }
    return map;
  }, [unitActies]);

  async function saveActie() {
    if (!draftRow || !titel.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stuur/acties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unit,
          row_key: draftRow.key,
          row_label: draftRow.label,
          titel: titel.trim(),
          notitie: notitie.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setActies((prev) => [data.actie as StuurActie, ...prev]);
      setDraftRow(null);
      setTitel("");
      setNotitie("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function completeActie(id: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/stuur/acties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "done" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Afvinken mislukt");
      setActies((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Afvinken mislukt");
    } finally {
      setBusy(false);
    }
  }

  function openDraft(row: StuurRow) {
    setDraftRow(row);
    setTitel(
      row.status === "tekort"
        ? `${row.label}: tekort oplossen`
        : `Actie · ${row.label}`
    );
    setNotitie(row.detail);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {board
            ? `L2A ${board.l2aPct}% · maand (${board.monthDays}d leads · ${board.weeksAhead} wkn slots)`
            : "Per unit: status + actie voor jezelf"}
        </p>
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

      <nav
        className="flex gap-0.5 overflow-x-auto border-b border-line"
        aria-label="Business units"
      >
        {STUUR_UNITS.map((u) => {
          const active = unit === u.id;
          const tekort =
            board?.units[u.id]?.rows.filter((r) => r.status === "tekort")
              .length || 0;
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => setUnit(u.id)}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-green text-green-deeper"
                  : "border-transparent text-muted hover:text-ink"
              )}
            >
              {u.label}
              {tekort > 0 ? (
                <span className="ml-1.5 inline-flex min-w-[1.1rem] items-center justify-center bg-[#9B2C2C] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                  {tekort}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {loading && !board ? (
        <p className="py-10 text-center text-sm text-muted">Laden…</p>
      ) : (
        <div className="overflow-hidden border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-wash/50 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-3 py-2.5 font-semibold">
                  {unit === "leads" ? "Provincie" : "Onderdeel"}
                </th>
                <th className="px-3 py-2.5 font-semibold tabular-nums">
                  Nu (30d)
                </th>
                <th className="px-3 py-2.5 font-semibold tabular-nums">
                  Nodig/maand
                </th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Detail</th>
                <th className="px-3 py-2.5 text-right font-semibold">Actie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => {
                const rowActs = actiesByRow.get(row.key) || [];
                return (
                  <tr key={row.key} className="hover:bg-wash/40">
                    <td className="px-3 py-2.5 font-medium text-ink">
                      {row.label}
                      {rowActs.length > 0 ? (
                        <ul className="mt-1 space-y-0.5">
                          {rowActs.map((a) => (
                            <li
                              key={a.id}
                              className="flex items-center gap-2 text-[11px] text-muted"
                            >
                              <span className="truncate">{a.titel}</span>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void completeActie(a.id)}
                                className="shrink-0 font-medium text-green-deeper hover:underline"
                              >
                                Klaar
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-ink">
                      {row.actual}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted">
                      {row.needed > 0 ? row.needed : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          "inline-flex px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          row.status === "ok"
                            ? "bg-green-soft text-green-deeper"
                            : "bg-[#FCEAEA] text-[#9B2C2C]"
                        )}
                      >
                        {row.status === "ok" ? "OK" : "Tekort"}
                      </span>
                    </td>
                    <td className="max-w-[18rem] px-3 py-2.5 text-xs text-muted">
                      {row.detail}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => openDraft(row)}
                      >
                        + Actie
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {draftRow ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Sluiten"
            onClick={() => setDraftRow(null)}
          />
          <div className="relative z-10 w-full max-w-md border border-line bg-white shadow-lg">
            <div className="border-b border-line px-4 py-3">
              <h3 className="text-sm font-semibold text-ink">
                Actie · {draftRow.label}
              </h3>
              <p className="mt-0.5 text-xs text-muted">{draftRow.detail}</p>
            </div>
            <div className="space-y-3 px-4 py-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Titel
                </span>
                <Input
                  value={titel}
                  onChange={(e) => setTitel(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Notitie
                </span>
                <Textarea
                  rows={3}
                  value={notitie}
                  onChange={(e) => setNotitie(e.target.value)}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDraftRow(null)}
              >
                Annuleren
              </Button>
              <Button
                type="button"
                disabled={busy || !titel.trim()}
                onClick={() => void saveActie()}
              >
                Opslaan
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

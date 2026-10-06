"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdviseurCreditFactuur } from "@/types/database";
import { formatDateShort, formatEuro } from "@/lib/format";

type Row = Pick<
  AdviseurCreditFactuur,
  | "id"
  | "factuur_nummer"
  | "status"
  | "week_jaar"
  | "week_nummer"
  | "bedrag_ex_btw"
  | "bedrag_inc_btw"
  | "factuurdatum"
  | "verzonden_op"
  | "goedgekeurd_op"
  | "betaald_op"
>;

function weekLabel(f: Row): string {
  if (f.week_jaar == null || f.week_nummer == null) return "—";
  return `${f.week_jaar}-W${String(f.week_nummer).padStart(2, "0")}`;
}

export function AdviseurFacturenPanel({
  onPendingChange,
}: {
  onPendingChange?: (count: number) => void;
} = {}) {
  const [facturen, setFacturen] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/adviseurs/creditfacturen/mijn");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setFacturen((data.facturen || []) as Row[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = useMemo(
    () => facturen.filter((f) => f.status === "verzonden"),
    [facturen]
  );
  const done = useMemo(
    () => facturen.filter((f) => f.status !== "verzonden"),
    [facturen]
  );

  useEffect(() => {
    onPendingChange?.(pending.length);
  }, [pending.length, onPendingChange]);

  async function goedkeuren(id: string) {
    setBusyId(id);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/adviseurs/creditfacturen/mijn", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "goedkeuren" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Goedkeuren mislukt");
      setOkMsg(
        `Factuur ${data.factuur?.factuur_nummer || ""} goedgekeurd. Batterijconcept kan uitbetalen.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Goedkeuren mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function downloadPdf(id: string, nummer: string) {
    setPdfBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/adviseurs/creditfacturen/${id}/pdf`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string }).error || "PDF download mislukt"
        );
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${nummer}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download mislukt");
    } finally {
      setPdfBusy(null);
    }
  }

  if (loading) {
    return (
      <p className="py-16 text-center text-sm text-muted">Facturen laden…</p>
    );
  }

  return (
    <div className="space-y-4">
      {(error || okMsg) && (
        <div className="space-y-2">
          {error && (
            <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
              {error}
            </p>
          )}
          {okMsg && (
            <p className="border border-green/30 bg-green-soft px-4 py-3 text-sm text-green-dark">
              {okMsg}
            </p>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <div className="border border-orange/40 bg-white">
          <div className="border-b border-orange/30 bg-[#FFF0E6] px-4 py-3 sm:px-5">
            <h2 className="font-display text-lg font-semibold text-ink">
              Te goedkeuren
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Controleer de PDF en keur goed zodat Batterijconcept kan
              uitbetalen.{" "}
              <span className="font-semibold text-[#C45A12]">
                {pending.length} open
              </span>
            </p>
          </div>
          <ul className="divide-y divide-line">
            {pending.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base font-semibold text-ink">
                    {f.factuur_nummer}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {formatDateShort(f.factuurdatum)}
                    {f.week_nummer != null ? ` · Week ${f.week_nummer}` : ""}
                    {" · "}
                    {formatEuro(f.bedrag_ex_btw)} excl. ·{" "}
                    {formatEuro(f.bedrag_inc_btw)} incl.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={pdfBusy === f.id}
                    onClick={() => void downloadPdf(f.id, f.factuur_nummer)}
                    className="border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-60"
                  >
                    {pdfBusy === f.id ? "…" : "Bekijk PDF"}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === f.id}
                    onClick={() => void goedkeuren(f.id)}
                    className="bg-orange px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {busyId === f.id ? "Bezig…" : "Goedkeuren"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {facturen.length === 0 ? (
        <div className="border border-line bg-white px-5 py-14 text-center">
          <p className="font-display text-base font-semibold text-ink">
            Nog geen facturen
          </p>
          <p className="mt-1 text-sm text-muted">
            Zodra Batterijconcept een commissiefactuur naar je stuurt, zie je
            die hier en kun je die goedkeuren.
          </p>
        </div>
      ) : (
        <div className="border border-line bg-white">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="font-display text-lg font-semibold text-ink">
              {pending.length > 0 ? "Overige facturen" : "Jouw facturen"}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {pending.length === 0
                ? "Geen openstaande goedkeuringen. Hieronder je goedgekeurde en betaalde facturen."
                : "Al goedgekeurd of betaald."}
            </p>
          </div>
          {done.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">
              Nog geen afgeronde facturen.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="crm-table w-full">
                <thead>
                  <tr>
                    <th>Nummer</th>
                    <th>Datum</th>
                    <th>Week</th>
                    <th className="text-right">Bedrag incl.</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {done.map((f) => (
                    <tr key={f.id}>
                      <td className="font-medium text-ink">
                        {f.factuur_nummer}
                      </td>
                      <td className="text-muted">
                        {formatDateShort(f.factuurdatum)}
                      </td>
                      <td className="text-muted tabular-nums">
                        {weekLabel(f)}
                      </td>
                      <td className="text-right tabular-nums font-medium">
                        {formatEuro(f.bedrag_inc_btw)}
                      </td>
                      <td>
                        {f.status === "betaald" ? (
                          <span className="inline-flex items-center gap-1 text-sm text-green-dark">
                            <span aria-hidden>✓</span>
                            Betaald
                            {f.betaald_op && (
                              <span className="text-xs text-muted">
                                {formatDateShort(f.betaald_op)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm text-green-dark">
                            <span aria-hidden>✓</span>
                            Goedgekeurd
                            {f.goedgekeurd_op && (
                              <span className="text-xs text-muted">
                                {formatDateShort(f.goedgekeurd_op)}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          disabled={pdfBusy === f.id}
                          onClick={() =>
                            void downloadPdf(f.id, f.factuur_nummer)
                          }
                          className="text-xs font-semibold text-green-dark hover:underline disabled:opacity-60"
                        >
                          {pdfBusy === f.id ? "…" : "PDF"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

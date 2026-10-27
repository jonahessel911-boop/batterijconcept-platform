"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEuro } from "@/lib/format";
import type { BellerWeekCommissie } from "@/lib/beller-commissie";

type Props = {
  bellerId: string;
  bellerNaam: string;
};

type ApiData = {
  perAfspraak: number;
  weeks: BellerWeekCommissie[];
  vorigeWeek: { jaar: number; week: number; van: string; tot: string };
};

export function BellerCommissieWeeks({ bellerId, bellerNaam }: Props) {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyWeek, setBusyWeek] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        beller_id: bellerId,
        weeks: "12",
      });
      const res = await fetch(`/api/rapportage/beller-commissie?${qs}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Laden mislukt"
        );
      }
      setData(json as ApiData);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [bellerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function maakFactuur(w: BellerWeekCommissie) {
    const key = `${w.jaar}-W${w.week}`;
    setBusyWeek(key);
    setOkMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/rapportage/beller-commissie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beller_id: bellerId,
          jaar: w.jaar,
          week: w.week,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Factuur mislukt"
        );
      }
      const nummer =
        (json as { factuur?: { factuur_nummer?: string } }).factuur
          ?.factuur_nummer || "concept";
      const created = Boolean((json as { created?: boolean }).created);
      setOkMsg(
        created
          ? `Concept ${nummer} aangemaakt (factuurdatum ma ${w.factuurMaandag}).`
          : (json as { message?: string }).message ||
              `Factuur bestaat al: ${nummer}`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusyWeek(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">
            Commissie per kalenderweek
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Netto afspraken (1e huisbezoek, niet geannuleerd) × €
            {data?.perAfspraak ?? 10}. Factuur op maandag voor de week ervoor.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs font-semibold text-green hover:underline"
        >
          Vernieuwen
        </button>
      </div>

      {okMsg ? (
        <p className="border border-green/30 bg-green-soft/50 px-3 py-2 text-[11px] text-green-dark">
          {okMsg}
        </p>
      ) : null}
      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-[11px] text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-muted">Laden…</p>
      ) : data && data.weeks.length > 0 ? (
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[640px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="bg-[#F3F5F4]">
                <th className="border-b border-line px-3 py-2 font-semibold uppercase tracking-wide text-muted">
                  Week
                </th>
                <th className="border-b border-line px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted">
                  Netto
                </th>
                <th className="border-b border-line px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted">
                  Commissie
                </th>
                <th className="border-b border-line px-3 py-2 font-semibold uppercase tracking-wide text-muted">
                  Factuur
                </th>
                <th className="border-b border-line px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted">
                  Actie
                </th>
              </tr>
            </thead>
            <tbody>
              {data.weeks.map((w) => {
                const key = `${w.jaar}-W${w.week}`;
                const busy = busyWeek === key;
                const hasCf = Boolean(w.creditfactuurId);
                return (
                  <tr
                    key={key}
                    className={
                      w.isVorigeWeek ? "bg-[#F3F7F4]" : "hover:bg-[#FAFBFA]"
                    }
                  >
                    <td className="border-b border-line px-3 py-2.5">
                      <p className="font-semibold text-ink">{w.label}</p>
                      <p className="text-[10px] text-muted">
                        {w.van} – {w.tot}
                        {w.isVorigeWeek ? " · vorige week" : ""}
                      </p>
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-right tabular-nums font-semibold text-ink">
                      {w.afspraken}
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-right tabular-nums text-ink">
                      {formatEuro(w.bedragExBtw)}
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-muted">
                      {hasCf ? (
                        <span className="text-ink">
                          {w.creditfactuurNummer}{" "}
                          <span className="text-[10px] uppercase text-muted">
                            ({w.creditfactuurStatus})
                          </span>
                        </span>
                      ) : (
                        <span className="text-[11px]">
                          Ma {w.factuurMaandag}
                        </span>
                      )}
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-right">
                      {hasCf ? (
                        <span className="text-[11px] text-muted">—</span>
                      ) : w.afspraken > 0 ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void maakFactuur(w)}
                          className="border border-green bg-white px-2.5 py-1 text-[11px] font-semibold text-green-dark hover:bg-green-soft disabled:opacity-50"
                          title={`Maak concept voor ${bellerNaam}`}
                        >
                          {busy ? "Bezig…" : "Maak factuur"}
                        </button>
                      ) : (
                        <span className="text-[11px] text-muted">Geen</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">Geen weekdata.</p>
      )}
    </div>
  );
}

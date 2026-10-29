"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type OrderRow = {
  id: string;
  project_nummer: string | null;
  titel: string | null;
  klant: string | null;
  plaats: string | null;
  verantwoordelijke_id: string | null;
  verantwoordelijke_naam: string | null;
};

type BarRow = {
  status: string;
  label: string;
  count: number;
  projects: OrderRow[];
};

type Payload = {
  ok?: boolean;
  total: number;
  active: number;
  max: number;
  bars: BarRow[];
  error?: string;
};

function num(n: number): string {
  return n.toLocaleString("nl-NL");
}

export function OperationeelRapportagePanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openStatus, setOpenStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rapportage/operationeel");
      const json = (await res.json()) as Payload;
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleStatus(status: string) {
    setOpenStatus((cur) => (cur === status ? null : status));
  }

  if (loading && !data) {
    return <p className="px-4 py-10 text-center text-sm text-muted">Laden…</p>;
  }

  if (error && !data) {
    return (
      <p className="px-4 py-6 text-sm text-[#C45A12]">
        {error}{" "}
        <button
          type="button"
          onClick={() => void load()}
          className="font-semibold underline"
        >
          Opnieuw
        </button>
      </p>
    );
  }

  if (!data) return null;

  const max = Math.max(1, data.max);
  const chartMax = Math.max(...data.bars.map((b) => b.count), 1);
  const openBar = data.bars.find((b) => b.status === openStatus) || null;

  return (
    <div className="space-y-5 px-4 py-5 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold text-ink">
            Orders per status
          </p>
          <p className="mt-0.5 text-sm text-muted">
            Klik op een staaf of rij om orders te zien · klant +
            backoffice-verantwoordelijke
          </p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Actief
            </p>
            <p className="font-display text-2xl font-semibold tabular-nums text-ink">
              {num(data.active)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Totaal in grafiek
            </p>
            <p className="font-display text-2xl font-semibold tabular-nums text-ink">
              {num(data.total)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="self-end border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
          >
            Vernieuwen
          </button>
        </div>
      </div>

      <div className="border border-line bg-white p-4 sm:p-5">
        <div
          className="flex items-end gap-1.5 overflow-x-auto pb-1 sm:gap-2"
          style={{ minHeight: 220 }}
        >
          {data.bars.map((b) => {
            const pct = Math.round((b.count / chartMax) * 100);
            const isMuted =
              b.status === "annulering" || b.status === "hold_sales_actie";
            const isEnd =
              b.status === "installatie_voltooid" ||
              b.status === "review_gevraagd" ||
              b.status === "afgerond";
            const isOpen = openStatus === b.status;
            return (
              <button
                key={b.status}
                type="button"
                disabled={b.count === 0}
                onClick={() => toggleStatus(b.status)}
                className={[
                  "flex w-[4.25rem] shrink-0 flex-col items-center sm:w-[5rem]",
                  b.count === 0 ? "cursor-default opacity-50" : "cursor-pointer",
                  isOpen ? "opacity-100" : "",
                ].join(" ")}
                title={`${b.label}: ${b.count} — klik om orders te tonen`}
              >
                <p className="mb-1 text-xs font-semibold tabular-nums text-ink">
                  {b.count > 0 ? num(b.count) : "·"}
                </p>
                <div
                  className={[
                    "flex h-40 w-full items-end justify-center rounded-t px-1 pt-2",
                    isOpen ? "bg-green-soft" : "bg-wash",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "w-full max-w-[2.25rem] rounded-t transition-[height] duration-500",
                      isMuted
                        ? "bg-[#C5CDC8]"
                        : isEnd
                          ? "bg-green-dark"
                          : "bg-green",
                    ].join(" ")}
                    style={{
                      height: b.count === 0 ? 2 : `${Math.max(pct, 4)}%`,
                    }}
                  />
                </div>
                <p
                  className={[
                    "mt-2 h-10 w-full text-center text-[10px] font-medium leading-tight",
                    isOpen ? "font-semibold text-green-dark" : "text-muted",
                  ].join(" ")}
                >
                  {b.label}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {openBar ? (
        <div className="border border-green/40 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold text-ink">
              {openBar.label}{" "}
              <span className="font-normal text-muted">
                · {num(openBar.count)}{" "}
                {openBar.count === 1 ? "order" : "orders"}
              </span>
            </p>
            <button
              type="button"
              onClick={() => setOpenStatus(null)}
              className="text-xs font-semibold text-muted hover:text-ink"
            >
              Sluiten
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-2">Order</th>
                  <th className="px-3 py-2">Klant</th>
                  <th className="px-3 py-2">Backoffice</th>
                  <th className="px-4 py-2 text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {(openBar.projects || []).map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-line/70 last:border-b-0"
                  >
                    <td className="px-4 py-2.5 align-middle">
                      <p className="font-mono text-xs font-semibold text-green-dark">
                        {p.project_nummer || "—"}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <p className="font-medium text-ink">{p.klant || "—"}</p>
                      {p.plaats ? (
                        <p className="text-xs text-muted">{p.plaats}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      {p.verantwoordelijke_naam ? (
                        <p className="text-sm text-ink">
                          {p.verantwoordelijke_naam}
                        </p>
                      ) : (
                        <p className="text-xs text-[#C45A12]">Niet toegewezen</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 align-middle text-right">
                      <Link
                        href={`/projecten/${p.id}?from=rapportage`}
                        className="inline-flex h-8 items-center border border-line px-2.5 text-[11px] font-semibold text-ink hover:bg-wash"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="border border-line bg-white">
        <p className="border-b border-line px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
          Detail — klik om open te klappen
        </p>
        <ul className="divide-y divide-line">
          {data.bars.map((b) => {
            const pct = Math.round((b.count / max) * 100);
            const isOpen = openStatus === b.status;
            return (
              <li key={`row-${b.status}`}>
                <button
                  type="button"
                  disabled={b.count === 0}
                  onClick={() => toggleStatus(b.status)}
                  className={[
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left",
                    b.count === 0
                      ? "cursor-default opacity-50"
                      : "hover:bg-wash",
                    isOpen ? "bg-green-soft/40" : "",
                  ].join(" ")}
                >
                  <p className="w-40 shrink-0 truncate text-sm font-medium text-ink sm:w-52">
                    {b.label}
                  </p>
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-wash">
                    <div
                      className="h-full rounded-full bg-green transition-[width] duration-500"
                      style={{
                        width: b.count === 0 ? "0%" : `${Math.max(pct, 3)}%`,
                      }}
                    />
                  </div>
                  <p className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
                    {num(b.count)}
                  </p>
                  <span className="w-14 shrink-0 text-right text-[10px] font-semibold text-muted">
                    {b.count === 0 ? "" : isOpen ? "Sluiten" : "Open"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

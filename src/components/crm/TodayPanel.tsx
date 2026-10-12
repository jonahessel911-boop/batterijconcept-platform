"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEuro, formatTimeNl } from "@/lib/format";
import type { DashboardV2Vandaag } from "@/lib/dashboard-v2";

function num(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1000) {
    return `€${(n / 1000).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}k`;
  }
  return formatEuro(n);
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border border-line bg-white px-3.5 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

const BUCKET_LABEL = {
  te_lopen: "Nog te lopen",
  gelopen: "Gelopen",
  niet_afgeboekt: "Niet afgeboekt",
} as const;

const BUCKET_CLS = {
  te_lopen: "bg-wash text-ink",
  gelopen: "bg-green-soft text-green-dark",
  niet_afgeboekt: "bg-[#FFF0E6] text-[#C45A12]",
} as const;

export function TodayPanel() {
  const [data, setData] = useState<DashboardV2Vandaag | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        "/api/dashboard-v2?period=last_7_days&scope=team",
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData((json.vandaag as DashboardV2Vandaag) || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void load({ silent: true });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (loading && !data) {
    return <p className="text-sm text-muted">Laden…</p>;
  }

  if (error && !data) {
    return (
      <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
        {error}
      </p>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted">Geen data.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">Today</h2>
          <p className="text-sm capitalize text-muted">{data.dateLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-muted hover:bg-wash hover:text-ink"
        >
          Vernieuwen
        </button>
      </div>

      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <Stat
          label="Offertes verstuurd"
          value={num(data.offertesVerstuurd)}
        />
        <Stat label="Orders" value={num(data.orders)} />
        <Stat
          label="Orderwaarde"
          value={money(data.orderwaarde)}
          hint="excl. btw"
        />
        <Stat label="Leads" value={num(data.leads)} />
        <Stat label="Leads ingepland" value={num(data.leadsIngepland)} />
        <Stat
          label="Afspraken te lopen"
          value={num(data.afsprakenTeLopen)}
        />
        <Stat
          label="Niet afgeboekt"
          value={num(data.afsprakenNietAfgeboekt)}
          hint={`${num(data.afsprakenGelopen)} afgeboekt`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 border border-line bg-white">
          <div className="border-b border-line bg-[#fafbfa] px-3.5 py-2.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Sales & omzet per verkoper
            </h3>
          </div>
          {data.verkopers.length === 0 ? (
            <p className="px-3.5 py-6 text-sm text-muted">
              Nog geen sales of afspraken vandaag.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="crm-table crm-table--compact w-full">
                <thead>
                  <tr>
                    <th>Verkoper</th>
                    <th>Sales</th>
                    <th>Omzet</th>
                    <th>Te lopen</th>
                    <th>Gelopen</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {data.verkopers.map((v) => (
                    <tr key={v.id} className="!cursor-default">
                      <td className="font-medium text-ink">{v.naam}</td>
                      <td className="tabular-nums">{num(v.sales)}</td>
                      <td className="tabular-nums font-semibold">
                        {money(v.omzet)}
                      </td>
                      <td className="tabular-nums text-muted">
                        {num(v.afsprakenTeLopen)}
                      </td>
                      <td className="tabular-nums text-muted">
                        {num(v.afsprakenGelopen)}
                      </td>
                      <td className="tabular-nums text-[#C45A12]">
                        {num(v.afsprakenNietAfgeboekt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="min-w-0 border border-line bg-white">
          <div className="border-b border-line bg-[#fafbfa] px-3.5 py-2.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Afspraken vandaag
            </h3>
          </div>
          {data.afspraken.length === 0 ? (
            <p className="px-3.5 py-6 text-sm text-muted">
              Geen huisbezoeken gepland vandaag.
            </p>
          ) : (
            <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto">
              {data.afspraken.map((a) => (
                <li
                  key={a.id}
                  className="flex items-start justify-between gap-3 px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {formatTimeNl(a.start_at)} ·{" "}
                      {a.lead_naam || a.lead_number || "Lead"}
                    </p>
                    <p className="truncate text-[11px] text-muted">
                      {a.adviseur_naam}
                      {a.lead_plaats ? ` · ${a.lead_plaats}` : ""}
                    </p>
                  </div>
                  <span
                    className={[
                      "shrink-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      BUCKET_CLS[a.bucket],
                    ].join(" ")}
                  >
                    {BUCKET_LABEL[a.bucket]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

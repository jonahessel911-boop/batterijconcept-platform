"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BelWeekBucket } from "@/lib/bel-rapportage";
import type { SalesAnnuleringWeek } from "@/lib/sales-annulering-rapportage";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SideTab = "afspraak" | "sales";

type BelPayload = {
  periodLabel?: string;
  totals?: {
    geannuleerd?: number;
    annuleringsPct?: number | null;
    ingepland?: number;
  };
  series?: BelWeekBucket[];
  error?: string;
};

type SalesPayload = {
  periodLabel?: string;
  totals?: {
    sales?: number;
    geannuleerd?: number;
    hold?: number;
    uitvalPct?: number | null;
  };
  series?: SalesAnnuleringWeek[];
  error?: string;
};

function num(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL");
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toLocaleString("nl-NL", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  })}%`;
}

function UitvalLineChart({
  points,
}: {
  points: { key: string; label: string; pct: number | null; count: number }[];
}) {
  const w = 960;
  const h = 280;
  const padL = 36;
  const padR = 16;
  const padT = 20;
  const padB = 48;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const maxPct = Math.max(
    20,
    ...points.map((p) => (p.pct != null && p.pct > 0 ? p.pct : 0))
  );
  const n = Math.max(1, points.length);
  const step = innerW / n;

  const pts = points.map((p, i) => {
    const x = padL + step * (i + 0.5);
    const y =
      p.pct == null
        ? null
        : padT + innerH * (1 - Math.min(maxPct, Math.max(0, p.pct)) / maxPct);
    return { ...p, x, y };
  });

  const lineD = pts
    .filter((p): p is typeof p & { y: number } => p.y != null)
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">Geen data.</p>;
  }

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="block h-56 w-full sm:h-64"
      role="img"
      aria-label="Uitvalpercentage per week"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = padT + innerH * (1 - t);
        const val = Math.round(maxPct * t);
        return (
          <g key={t}>
            <line
              x1={padL}
              x2={w - padR}
              y1={y}
              y2={y}
              stroke="#E5E7EB"
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-[#9CA3AF]"
              style={{ fontSize: 10 }}
            >
              {val}%
            </text>
          </g>
        );
      })}
      {lineD ? (
        <path d={lineD} fill="none" stroke="#C45A12" strokeWidth={2.5} />
      ) : null}
      {pts.map((p) =>
        p.y != null ? (
          <circle
            key={p.key}
            cx={p.x}
            cy={p.y}
            r={3.5}
            fill="#C45A12"
          >
            <title>
              {p.label}: {fmtPct(p.pct)} ({num(p.count)} geannuleerd)
            </title>
          </circle>
        ) : null
      )}
      {pts.map((p, i) =>
        i % Math.ceil(n / 8) === 0 || i === n - 1 ? (
          <text
            key={`lbl-${p.key}`}
            x={p.x}
            y={h - 14}
            textAnchor="middle"
            className="fill-[#6B7280]"
            style={{ fontSize: 10 }}
          >
            {p.label.replace(/^Week\s*/i, "W")}
          </text>
        ) : null
      )}
    </svg>
  );
}

export function AnnuleringenRapportagePanel() {
  const [side, setSide] = useState<SideTab>("afspraak");
  const [bel, setBel] = useState<BelPayload | null>(null);
  const [sales, setSales] = useState<SalesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (tab: SideTab) => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "afspraak") {
        const res = await fetch("/api/rapportage/bel");
        const data = (await res.json()) as BelPayload;
        if (!res.ok) throw new Error(data.error || "Laden mislukt");
        setBel(data);
      } else {
        const res = await fetch("/api/rapportage/sales-annuleringen");
        const data = (await res.json()) as SalesPayload;
        if (!res.ok) throw new Error(data.error || "Laden mislukt");
        setSales(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(side);
  }, [side, load]);

  const afspraakPoints = useMemo(
    () =>
      (bel?.series || []).map((w) => ({
        key: w.weekKey,
        label: w.label,
        pct: w.annuleringsPct,
        count: w.geannuleerd,
      })),
    [bel]
  );

  const salesPoints = useMemo(
    () =>
      (sales?.series || []).map((w) => ({
        key: w.weekKey,
        label: w.label,
        pct: w.uitvalPct,
        count: w.geannuleerd,
      })),
    [sales]
  );

  return (
    <div className="space-y-4 px-4 py-5 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Annuleringen
          </p>
          <p className="mt-0.5 text-sm text-muted">
            {side === "afspraak"
              ? "Afspraak-uitval % per week (geannuleerde huisbezoeken ÷ geplaatste)."
              : "Sales-uitval % op ondertekenweek (annulering + HOLD, 1× per lead)."}
          </p>
        </div>
        <Tabs
          value={side}
          onValueChange={(v) => setSide(v as SideTab)}
          className="min-w-0"
        >
          <TabsList>
            <TabsTrigger value="afspraak">Afspraak uitval</TabsTrigger>
            <TabsTrigger value="sales">Sales annuleringen</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {loading && !bel && !sales ? (
        <p className="py-10 text-center text-sm text-muted">Laden…</p>
      ) : side === "afspraak" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="border border-line bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Periode
              </p>
              <p className="mt-1 text-sm font-medium text-ink">
                {bel?.periodLabel || "—"}
              </p>
            </div>
            <div className="border border-line bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Geannuleerd
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                {num(bel?.totals?.geannuleerd)}
              </p>
              <p className="text-xs text-muted">
                van {num(bel?.totals?.ingepland)} ingepland
              </p>
            </div>
            <div className="border border-line bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Uitval %
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#C45A12]">
                {fmtPct(bel?.totals?.annuleringsPct)}
              </p>
            </div>
          </div>

          <div className="border border-line bg-white px-3 py-3 sm:px-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Uitval % per week
            </p>
            <UitvalLineChart points={afspraakPoints} />
          </div>

          <div className="overflow-x-auto border border-line bg-white">
            <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-wash/70 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">Week</th>
                  <th className="px-3 py-2 text-right">Ingepland</th>
                  <th className="px-3 py-2 text-right">Geannuleerd</th>
                  <th className="px-3 py-2 text-right">Uitval %</th>
                </tr>
              </thead>
              <tbody>
                {(bel?.series || []).map((w) => (
                  <tr key={w.weekKey} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-medium text-ink">{w.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {num(w.ingepland)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {num(w.geannuleerd)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#C45A12]">
                      {fmtPct(w.annuleringsPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="border border-line bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Periode
              </p>
              <p className="mt-1 text-sm font-medium text-ink">
                {sales?.periodLabel || "—"}
              </p>
            </div>
            <div className="border border-line bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Geannuleerd
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                {num(sales?.totals?.geannuleerd)}
              </p>
              <p className="text-xs text-muted">
                van {num(sales?.totals?.sales)} getekend
              </p>
            </div>
            <div className="border border-line bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                HOLD
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                {num(sales?.totals?.hold)}
              </p>
            </div>
            <div className="border border-line bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Uitval %
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#C45A12]">
                {fmtPct(sales?.totals?.uitvalPct)}
              </p>
            </div>
          </div>

          <div className="border border-line bg-white px-3 py-3 sm:px-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Uitval % per ondertekenweek
            </p>
            <UitvalLineChart points={salesPoints} />
          </div>

          <div className="overflow-x-auto border border-line bg-white">
            <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-wash/70 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">Week</th>
                  <th className="px-3 py-2 text-right">Sales</th>
                  <th className="px-3 py-2 text-right">Geannuleerd</th>
                  <th className="px-3 py-2 text-right">HOLD</th>
                  <th className="px-3 py-2 text-right">Uitval %</th>
                </tr>
              </thead>
              <tbody>
                {(sales?.series || []).map((w) => (
                  <tr key={w.weekKey} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-medium text-ink">{w.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {num(w.sales)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {num(w.geannuleerd)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {num(w.hold)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#C45A12]">
                      {fmtPct(w.uitvalPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import type { Adviseur } from "@/types/database";
import type {
  FinancialBreakdownRow,
  FinancialCostSlice,
  FinancialDashboardData,
  FinancialDateRange,
  FinancialDayPoint,
  FinancialDealBucket,
  FinancialFunnelStep,
} from "@/lib/financial-dashboard";
import { financialRangeLabel } from "@/lib/financial-dashboard";
import { formatEuro } from "@/lib/format";

const RANGES: FinancialDateRange[] = [
  "this_week",
  "last_7_days",
  "this_month",
  "last_30_days",
  "this_year",
  "all_time",
];

function formatCompactEuro(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) {
    return `€${(n / 1000).toLocaleString("nl-NL", {
      minimumFractionDigits: abs >= 10000 ? 0 : 1,
      maximumFractionDigits: 1,
    })}k`;
  }
  return formatEuro(n);
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span
      className={[
        "inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
        up ? "text-green-dark" : "text-[#C62828]",
      ].join(" ")}
    >
      {up ? "↑" : "↓"} {Math.abs(pct).toLocaleString("nl-NL")}%
    </span>
  );
}

function KpiCard({
  title,
  value,
  format,
  deltaPct,
  subtitle,
}: {
  title: string;
  value: number;
  format: "money" | "percent" | "number";
  deltaPct: number | null;
  subtitle?: string;
}) {
  const display =
    format === "money"
      ? formatCompactEuro(value)
      : format === "percent"
        ? `${value.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`
        : value.toLocaleString("nl-NL");

  return (
    <div className="rounded-xl border border-line bg-white p-3.5 shadow-[0_1px_2px_rgba(26,31,28,0.04)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {title}
      </p>
      <p className="mt-1.5 font-display text-xl font-bold tabular-nums tracking-tight text-ink sm:text-2xl">
        {display}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <DeltaBadge pct={deltaPct} />
        <span className="text-[10px] text-muted">vs vorige</span>
      </div>
      {subtitle ? (
        <p className="mt-1 text-[10px] leading-snug text-muted">{subtitle}</p>
      ) : null}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  legend,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  legend?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "rounded-xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(26,31,28,0.04)]",
        className || "",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">{title}</p>
          {subtitle ? (
            <p className="mt-0.5 text-[11px] text-muted">{subtitle}</p>
          ) : null}
        </div>
        {legend ? <div className="flex flex-wrap gap-2.5">{legend}</div> : null}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function BarChart({
  data,
  keys,
  colors,
  height = 180,
  stacked = false,
  showZeroHint = true,
}: {
  data: FinancialDayPoint[];
  keys: (keyof FinancialDayPoint)[];
  colors: string[];
  height?: number;
  stacked?: boolean;
  showZeroHint?: boolean;
}) {
  const width = 560;
  const pad = { t: 12, r: 12, b: 36, l: 44 };
  const innerH = height - pad.t - pad.b;
  const innerW = width - pad.l - pad.r;
  const hasData = data.some((d) =>
    keys.some((k) => Number(d[k]) > 0)
  );

  const maxVal = useMemo(() => {
    if (!stacked) {
      return Math.max(
        1,
        ...data.flatMap((d) => keys.map((k) => Number(d[k]) || 0))
      );
    }
    return Math.max(
      1,
      ...data.map((d) => keys.reduce((s, k) => s + (Number(d[k]) || 0), 0))
    );
  }, [data, keys, stacked]);

  const barW = data.length > 0 ? innerW / data.length : 0;
  const gap = Math.min(8, barW * 0.28);
  const actualBarW = Math.max(2, barW - gap);
  const tickEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div className="relative" style={{ height }}>
      {!hasData && showZeroHint ? (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-muted">
          Geen waarden in deze periode
        </p>
      ) : null}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        role="img"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = pad.t + innerH * (1 - t);
          const val = maxVal * t;
          return (
            <g key={t}>
              <line
                x1={pad.l}
                x2={width - pad.r}
                y1={y}
                y2={y}
                stroke="#e2e8e4"
                strokeWidth={1}
              />
              <text
                x={pad.l - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill="#5a635c"
              >
                {formatCompactEuro(val).replace("€", "")}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = pad.l + i * barW + gap / 2;
          if (!stacked) {
            const val = Number(d[keys[0]]) || 0;
            const h = (val / maxVal) * innerH;
            return (
              <g key={d.date}>
                <rect
                  x={x}
                  y={pad.t + innerH - h}
                  width={actualBarW}
                  height={Math.max(0, h)}
                  fill={colors[0]}
                  rx={2}
                >
                  <title>
                    {d.label}: {formatEuro(val)}
                  </title>
                </rect>
                {i % tickEvery === 0 || i === data.length - 1 ? (
                  <text
                    x={x + actualBarW / 2}
                    y={height - 10}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#5a635c"
                  >
                    {d.label.split("–")[0]}
                  </text>
                ) : null}
              </g>
            );
          }
          let yOffset = pad.t + innerH;
          return (
            <g key={d.date}>
              {keys.map((key, ki) => {
                const val = Number(d[key]) || 0;
                const h = (val / maxVal) * innerH;
                yOffset -= h;
                return (
                  <rect
                    key={String(key)}
                    x={x}
                    y={yOffset}
                    width={actualBarW}
                    height={Math.max(0, h)}
                    fill={colors[ki % colors.length]}
                    rx={1}
                  >
                    <title>
                      {d.label} · {String(key)}: {formatEuro(val)}
                    </title>
                  </rect>
                );
              })}
              {i % tickEvery === 0 || i === data.length - 1 ? (
                <text
                  x={x + actualBarW / 2}
                  y={height - 10}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#5a635c"
                >
                  {d.label.split("–")[0]}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MultiLineChart({
  data,
  series,
  height = 200,
}: {
  data: FinancialDayPoint[];
  series: { key: keyof FinancialDayPoint; color: string; label: string }[];
  height?: number;
}) {
  const width = 560;
  const pad = { t: 14, r: 12, b: 36, l: 48 };
  const innerH = height - pad.t - pad.b;
  const innerW = width - pad.l - pad.r;

  const maxVal = Math.max(
    1,
    ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))
  );
  const minVal = Math.min(
    0,
    ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))
  );
  const range = maxVal - minVal || 1;
  const tickEvery = Math.max(1, Math.ceil(data.length / 8));

  function point(i: number, val: number) {
    const x =
      pad.l +
      (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = pad.t + innerH - ((val - minVal) / range) * innerH;
    return { x, y };
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = pad.t + innerH * (1 - t);
        const val = minVal + range * t;
        return (
          <g key={t}>
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={y}
              y2={y}
              stroke="#e2e8e4"
              strokeWidth={1}
            />
            <text
              x={pad.l - 6}
              y={y + 3}
              textAnchor="end"
              fontSize={10}
              fill="#5a635c"
            >
              {formatCompactEuro(val).replace("€", "")}
            </text>
          </g>
        );
      })}
      {series.map((s) => {
        const pts = data.map((d, i) => point(i, Number(d[s.key]) || 0));
        const line = pts
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
          .join(" ");
        const area =
          pts.length > 0
            ? `${line} L ${pts[pts.length - 1].x} ${pad.t + innerH} L ${pts[0].x} ${pad.t + innerH} Z`
            : "";
        return (
          <g key={s.label}>
            <path d={area} fill={s.color} fillOpacity={0.08} />
            <path
              d={line}
              fill="none"
              stroke={s.color}
              strokeWidth={2.2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        );
      })}
      {data.map((d, i) =>
        i % tickEvery === 0 || i === data.length - 1 ? (
          <text
            key={d.date}
            x={point(i, 0).x}
            y={height - 10}
            textAnchor="middle"
            fontSize={9}
            fill="#5a635c"
          >
            {d.label.split("–")[0]}
          </text>
        ) : null
      )}
    </svg>
  );
}

function FunnelChart({ steps }: { steps: FinancialFunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  const colors = ["#3b82f6", "#0d9488", "#1a8a3e"];
  return (
    <div className="space-y-2.5">
      {steps.map((s, i) => {
        const pct = (s.value / max) * 100;
        return (
          <div key={s.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-ink">{s.label}</span>
              <span className="tabular-nums text-muted">
                {s.value.toLocaleString("nl-NL")}
                {s.rateFromPrev != null ? (
                  <span className="ml-2 text-[10px]">
                    ({s.rateFromPrev}% van vorige)
                  </span>
                ) : null}
              </span>
            </div>
            <div className="h-8 overflow-hidden rounded bg-wash">
              <div
                className="flex h-full items-center px-2 text-[11px] font-semibold text-white transition-all"
                style={{
                  width: `${Math.max(pct, s.value > 0 ? 8 : 0)}%`,
                  backgroundColor: colors[i % colors.length],
                }}
              >
                {pct >= 18 ? `${Math.round(pct)}%` : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DonutChart({ slices }: { slices: FinancialCostSlice[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const size = 160;
  const r = 58;
  const cx = 80;
  const cy = 80;
  const stroke = 22;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#e2e8e4"
          strokeWidth={stroke}
        />
        {slices.map((s) => {
          const len = (s.value / total) * circ;
          const el = (
            <circle
              key={s.key}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            >
              <title>
                {s.label}: {formatEuro(s.value)}
              </title>
            </circle>
          );
          offset += len;
          return el;
        })}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          className="fill-ink"
          fontSize={12}
          fontWeight={700}
        >
          {formatCompactEuro(total)}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fontSize={9}
          fill="#5a635c"
        >
          totaal
        </text>
      </svg>
      <ul className="min-w-[10rem] space-y-1.5 text-xs">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3">
            <LegendItem color={s.color} label={s.label} />
            <span className="tabular-nums font-medium text-ink">
              {formatCompactEuro(s.value)}
              <span className="ml-1 text-muted">
                ({Math.round((s.value / total) * 100)}%)
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HorizontalBars({
  rows,
  valueKey,
  format = "money",
  color = "#3b82f6",
}: {
  rows: FinancialBreakdownRow[];
  valueKey: "omzet" | "deals" | "leads" | "winst";
  format?: "money" | "number";
  color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(Number(r[valueKey]) || 0)));
  if (rows.length === 0) {
    return <p className="py-6 text-center text-xs text-muted">Geen data</p>;
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const val = Number(r[valueKey]) || 0;
        const pct = (Math.abs(val) / max) * 100;
        return (
          <div key={r.key}>
            <div className="mb-0.5 flex justify-between gap-2 text-[11px]">
              <span className="truncate font-medium text-ink" title={r.label}>
                {r.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted">
                {format === "money" ? formatCompactEuro(val) : val}
                <span className="ml-1.5 text-[10px]">
                  {r.deals}d · {r.conversieDeal}%
                </span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded bg-wash">
              <div
                className="h-full rounded"
                style={{
                  width: `${pct}%`,
                  backgroundColor: val < 0 ? "#C62828" : color,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DealSizeBars({ buckets }: { buckets: FinancialDealBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="flex h-40 items-end gap-3 px-1">
      {buckets.map((b) => {
        const h = (b.count / max) * 100;
        return (
          <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] tabular-nums text-muted">
              {b.count}
            </span>
            <div className="flex h-28 w-full items-end">
              <div
                className="w-full rounded-t bg-[#3b82f6]"
                style={{ height: `${Math.max(h, b.count > 0 ? 6 : 0)}%` }}
                title={`${b.label}: ${b.count} deals · ${formatEuro(b.omzet)}`}
              />
            </div>
            <span className="text-[10px] font-medium text-ink">{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(26,31,28,0.04)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
      >
        <div>
          <p className="font-display text-sm font-semibold text-ink">{title}</p>
          <p className="mt-0.5 text-xs text-muted">{summary}</p>
        </div>
        <span className="shrink-0 text-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="border-t border-line px-4 py-4 sm:px-5">{children}</div>
      ) : null}
    </section>
  );
}

export function FinancialDashboard({
  data,
  range,
  onRangeChange,
  loading,
  adviseurs = [],
}: {
  data: FinancialDashboardData | null;
  range: FinancialDateRange;
  onRangeChange: (r: FinancialDateRange) => void;
  loading?: boolean;
  adviseurs?: Adviseur[];
}) {
  const t = data?.totals;
  const advNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of adviseurs) m.set(a.id, a.naam);
    return m;
  }, [adviseurs]);

  if (loading && !data) {
    return (
      <p className="px-4 py-16 text-center text-sm text-muted">
        Dashboard laden…
      </p>
    );
  }

  if (!data || !t) {
    return (
      <p className="px-4 py-16 text-center text-sm text-muted">
        Geen financiële data beschikbaar.
      </p>
    );
  }

  const chartSeries =
    data.series.length > 21 ? data.weeklySeries : data.series;
  const chartGrain = data.series.length > 21 ? "per week" : "per dag";

  const byAdvLabeled = data.byAdviseur.map((r) => ({
    ...r,
    label: advNames.get(r.key) || r.label,
  }));

  return (
    <div className="space-y-5 bg-wash/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            Financial Dashboard
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {data.rangeLabel} · omzet op tekenmoment · betaalde omzet op
            betaaldatum
          </p>
        </div>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Periode
          <select
            value={range}
            onChange={(e) =>
              onRangeChange(e.target.value as FinancialDateRange)
            }
            className="mt-1 block min-w-[11rem] border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
          >
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {financialRangeLabel(r)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <KpiCard
          title="Omzet"
          value={data.kpis.omzet.value}
          format="money"
          deltaPct={data.kpis.omzet.deltaPct}
          subtitle="Getekende offertes excl. btw"
        />
        <KpiCard
          title="Winst"
          value={data.kpis.winst.value}
          format="money"
          deltaPct={data.kpis.winst.deltaPct}
          subtitle="Omzet − kosten"
        />
        <KpiCard
          title="Marge"
          value={data.kpis.marge.value}
          format="percent"
          deltaPct={data.kpis.marge.deltaPct}
        />
        <KpiCard
          title="Betaald"
          value={data.kpis.betaaldeOmzet.value}
          format="money"
          deltaPct={data.kpis.betaaldeOmzet.deltaPct}
        />
        <KpiCard
          title="ROI"
          value={data.kpis.roi.value}
          format="percent"
          deltaPct={data.kpis.roi.deltaPct}
        />
        <KpiCard
          title="CAC"
          value={data.kpis.cac.value}
          format="money"
          deltaPct={data.kpis.cac.deltaPct}
        />
        <KpiCard
          title="Gem. deal"
          value={data.kpis.gemDealWaarde.value}
          format="money"
          deltaPct={data.kpis.gemDealWaarde.deltaPct}
        />
        <KpiCard
          title="Deals"
          value={data.kpis.deals.value}
          format="number"
          deltaPct={data.kpis.deals.deltaPct}
        />
      </div>

      {/* Primary charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Cumulatieve omzet & winst"
          subtitle={`Lopende totalen · ${chartGrain}`}
          legend={
            <>
              <LegendItem color="#3b82f6" label="Omzet" />
              <LegendItem color="#1a8a3e" label="Winst" />
            </>
          }
        >
          <div className="h-52">
            <MultiLineChart
              data={chartSeries}
              series={[
                { key: "cumOmzet", color: "#3b82f6", label: "Omzet" },
                { key: "cumWinst", color: "#1a8a3e", label: "Winst" },
              ]}
              height={208}
            />
          </div>
        </ChartCard>

        <ChartCard
          title="Omzet vs betaalde omzet"
          subtitle={`${chartGrain} · cashflow vs tekenmoment`}
          legend={
            <>
              <LegendItem color="#3b82f6" label="Omzet (deals)" />
              <LegendItem color="#0d9488" label="Betaald" />
            </>
          }
        >
          <div className="h-52">
            <MultiLineChart
              data={chartSeries}
              series={[
                { key: "omzet", color: "#3b82f6", label: "Omzet" },
                {
                  key: "betaaldeOmzet",
                  color: "#0d9488",
                  label: "Betaald",
                },
              ]}
              height={208}
            />
          </div>
        </ChartCard>

        <ChartCard
          title="Omzet over tijd"
          subtitle={`Staafdiagram · ${chartGrain}`}
        >
          <BarChart data={chartSeries} keys={["omzet"]} colors={["#3b82f6"]} />
        </ChartCard>

        <ChartCard
          title="Kostenopbouw per periode"
          subtitle={`Gestapeld · ${chartGrain}`}
          legend={
            <>
              <LegendItem color="#ef4444" label="Inkoop" />
              <LegendItem color="#f97316" label="Installatie" />
              <LegendItem color="#8b5cf6" label="Ads/sales" />
            </>
          }
        >
          <BarChart
            data={chartSeries}
            keys={["inkoop", "projectkosten", "adSpend"]}
            colors={["#ef4444", "#f97316", "#8b5cf6"]}
            stacked
          />
        </ChartCard>
      </div>

      {/* Funnel + mix + volume */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Conversiefunnel"
          subtitle={`${t.conversieDeal}% lead → deal · ${t.uitvalPct}% afspraakuitval`}
        >
          <FunnelChart steps={data.funnel} />
        </ChartCard>

        <ChartCard
          title="Kosten & winst mix"
          subtitle="Verdeling van omzetbestanddelen"
        >
          {data.costMix.length > 0 ? (
            <DonutChart slices={data.costMix} />
          ) : (
            <p className="py-8 text-center text-xs text-muted">
              Nog geen kosten/omzet
            </p>
          )}
        </ChartCard>

        <ChartCard
          title="Dealgrootte"
          subtitle="Aantal deals per waardesegment"
        >
          <DealSizeBars buckets={data.dealBuckets} />
        </ChartCard>
      </div>

      {/* Volume lines */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Leads, afspraken & deals"
          subtitle={`Volume · ${chartGrain}`}
          legend={
            <>
              <LegendItem color="#64748b" label="Leads" />
              <LegendItem color="#0d9488" label="Afspraken" />
              <LegendItem color="#1a8a3e" label="Deals" />
            </>
          }
        >
          <div className="h-48">
            <MultiLineChart
              data={chartSeries}
              series={[
                { key: "leads", color: "#64748b", label: "Leads" },
                { key: "afspraken", color: "#0d9488", label: "Afspraken" },
                { key: "deals", color: "#1a8a3e", label: "Deals" },
              ]}
              height={192}
            />
          </div>
        </ChartCard>

        <ChartCard
          title="Cumulatieve deals & leads"
          subtitle="Groei over de periode"
          legend={
            <>
              <LegendItem color="#64748b" label="Leads cum." />
              <LegendItem color="#1a8a3e" label="Deals cum." />
            </>
          }
        >
          <div className="h-48">
            <MultiLineChart
              data={chartSeries}
              series={[
                { key: "cumLeads", color: "#64748b", label: "Leads" },
                { key: "cumDeals", color: "#1a8a3e", label: "Deals" },
              ]}
              height={192}
            />
          </div>
        </ChartCard>
      </div>

      {/* Breakdowns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Omzet per lander"
          subtitle="Top bronnen in deze periode"
        >
          <HorizontalBars
            rows={data.byLander}
            valueKey="omzet"
            color="#3b82f6"
          />
        </ChartCard>
        <ChartCard
          title="Omzet per adviseur"
          subtitle="Getekende deals toegerekend"
        >
          <HorizontalBars
            rows={byAdvLabeled}
            valueKey="omzet"
            color="#1a8a3e"
          />
        </ChartCard>
      </div>

      {/* Collapsible detail tables */}
      <div className="grid gap-3 lg:grid-cols-2">
        <CollapsibleSection
          title="P&L overzicht"
          summary={`Omzet ${formatEuro(t.omzet)} · Winst ${formatEuro(t.winst)}`}
          defaultOpen
        >
          <dl className="grid gap-2 text-sm">
            {[
              ["Omzet (deals)", t.omzet],
              ["Betaalde omzet", t.betaaldeOmzet],
              ["Inkoop hardware", -t.inkoop],
              ["Installatiekosten", -t.projectkosten],
              ["Ad spend", -t.adSpend],
              ["Sales kosten", -t.salesKosten],
              ["Winst", t.winst],
            ].map(([label, val]) => (
              <div
                key={String(label)}
                className="flex items-center justify-between border-b border-line/60 py-1.5 last:border-0"
              >
                <dt className="text-muted">{label}</dt>
                <dd
                  className={[
                    "font-semibold tabular-nums",
                    Number(val) < 0 ? "text-[#C62828]" : "text-ink",
                  ].join(" ")}
                >
                  {formatEuro(Math.abs(Number(val)))}
                  {Number(val) < 0 ? " −" : ""}
                </dd>
              </div>
            ))}
          </dl>
        </CollapsibleSection>

        <CollapsibleSection
          title="Funnel-cijfers"
          summary={`${t.leads} leads · ${t.deals} deals · ${t.conversieDeal}%`}
          defaultOpen
        >
          <dl className="grid gap-2 text-sm">
            {[
              ["Leads", t.leads],
              ["Afspraken bruto", t.brutoAfspraken],
              ["Afspraken netto", t.nettoAfspraken],
              ["% uitval", `${t.uitvalPct}%`],
              ["Lead → afspraak", `${t.conversieAfspraak}%`],
              ["Lead → deal", `${t.conversieDeal}%`],
              ["Deals", t.deals],
              ["Gem. dealwaarde", formatEuro(t.gemDealWaarde)],
              ["CAC", formatEuro(t.cac)],
            ].map(([label, val]) => (
              <div
                key={String(label)}
                className="flex items-center justify-between border-b border-line/60 py-1.5 last:border-0"
              >
                <dt className="text-muted">{label}</dt>
                <dd className="font-semibold tabular-nums text-ink">{val}</dd>
              </div>
            ))}
          </dl>
        </CollapsibleSection>

        <CollapsibleSection
          title="Vergelijking vorige periode"
          summary="Zelfde lengte als geselecteerde periode"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                  <th className="pb-2 pr-3">Metric</th>
                  <th className="pb-2 pr-3 text-right">Huidig</th>
                  <th className="pb-2 pr-3 text-right">Vorig</th>
                  <th className="pb-2 text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Omzet", data.kpis.omzet, data.previousTotals.omzet],
                    ["Winst", data.kpis.winst, data.previousTotals.winst],
                    [
                      "Betaalde omzet",
                      data.kpis.betaaldeOmzet,
                      data.previousTotals.betaaldeOmzet,
                    ],
                    ["Deals", data.kpis.deals, data.previousTotals.deals],
                    ["Marge %", data.kpis.marge, data.previousTotals.margePct],
                    ["ROI %", data.kpis.roi, data.previousTotals.roiPct],
                  ] as const
                ).map(([label, kpiRow, prev]) => (
                  <tr key={label} className="border-b border-line/60">
                    <td className="py-2 pr-3 text-muted">{label}</td>
                    <td className="py-2 pr-3 text-right font-medium tabular-nums">
                      {label.includes("%") || label === "Deals"
                        ? kpiRow.value
                        : formatEuro(kpiRow.value)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted">
                      {label.includes("%") || label === "Deals"
                        ? prev
                        : formatEuro(prev)}
                    </td>
                    <td className="py-2 text-right">
                      <DeltaBadge pct={kpiRow.deltaPct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Ad spend & kosten"
          summary={
            t.adSpend + t.salesKosten > 0
              ? `${formatEuro(t.adSpend + t.salesKosten)} in rapportage_kosten`
              : "Nog geen ad spend — vul rapportage_kosten"
          }
        >
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between border-b border-line/60 py-1.5">
              <dt className="text-muted">Ad spend</dt>
              <dd className="font-semibold tabular-nums">
                {formatEuro(t.adSpend)}
              </dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-muted">Sales kosten</dt>
              <dd className="font-semibold tabular-nums">
                {formatEuro(t.salesKosten)}
              </dd>
            </div>
          </dl>
        </CollapsibleSection>
      </div>
    </div>
  );
}

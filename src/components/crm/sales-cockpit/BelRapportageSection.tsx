"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
import { Badge as UiBadge } from "@/components/ui/badge";
import {
  Card as UiCard,
  CardAction,
  CardContent as UiCardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Card,
  CardContent,
} from "@/components/crm/sales-cockpit/ui/card";
import { Badge } from "@/components/crm/sales-cockpit/ui/badge";
import { Avatar, AvatarFallback } from "@/components/crm/sales-cockpit/ui/avatar";
import { DataTable, type DataColumn } from "@/components/crm/sales-cockpit/ui/data-table";
import { Skeleton } from "@/components/crm/sales-cockpit/ui/skeleton";
import {
  DistributionPieChart,
  DualAreaChart,
  type ChartSeries,
} from "@/components/crm/sales-cockpit/ui/charts";
import {
  buildBelTrendSeries,
  type BelCockpitOverview,
  type BelKpiKey,
  type BelLeaderboardPeriodId,
  type BelLeaderboardRow,
  type BelPeriodSnapshot,
  type BelSeriesPoint,
} from "@/lib/sales-cockpit/bel-rapportage";
import type { BelMetrics } from "@/lib/bel-rapportage";
import {
  defaultGroupBy,
  formatRangeLabel,
  isYmd,
  trendPeriodRange,
  TREND_PERIOD_IDS,
  type DateRange,
  type GroupBy,
  type TrendPeriodId,
} from "@/lib/sales-cockpit/range";
import { round2, safeDiv } from "@/lib/management-dashboard/periods";
import { cn } from "@/lib/cn";

function initials(naam: string): string {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] || ""}${parts[parts.length - 1]![0] || ""}`.toUpperCase();
}

function MiniBar({
  value,
  max = 100,
  colorClass = "bg-emerald-600",
}: {
  value: number;
  max?: number;
  colorClass?: string;
}) {
  const width = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-1 w-11 overflow-hidden rounded-full bg-zinc-100">
      <div
        className={cn("h-full rounded-full transition-all", colorClass)}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function ConvCell({ pct }: { pct: number | null }) {
  return (
    <div className="inline-flex flex-col items-end gap-1">
      <span
        className={cn(
          "tabular-nums font-semibold",
          pct == null ? "text-muted" : "text-green-deeper"
        )}
      >
        {pct == null
          ? "—"
          : `${pct.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`}
      </span>
      <MiniBar value={pct ?? 0} colorClass="bg-emerald-600" />
    </div>
  );
}

/** Uitkomst-slices in de pie (gebeld = centrumtotaal). */
const PIE_SLICES: {
  key: Exclude<BelKpiKey, "gebeld">;
  label: string;
  color: string;
}[] = [
  { key: "ingepland", label: "Ingepland", color: "#059669" },
  { key: "geenInteresse", label: "Negatief", color: "#e11d48" },
  { key: "geenContact", label: "Geen contact", color: "#d97706" },
];

const LEGEND_ROWS = PIE_SLICES;

type BelTrendMetricId =
  | "gebeld"
  | "ingepland"
  | "convGebeldIngepland"
  | "convBereiktIngepland"
  | "convBereiktNegatief"
  | "convGebeldNietBereikt"
  | "uitvalH3"
  | "uitvalD3"
  | "uitvalD7"
  | "lateUitval3u"
  | "lateUitval24u";

type BelTrendMetric = {
  id: BelTrendMetricId;
  short: string;
  color: string;
  percent?: boolean;
};

type BelTrendMetricCategory = {
  id: string;
  label: string;
  metrics: BelTrendMetric[];
};

const TREND_METRIC_CATEGORIES: BelTrendMetricCategory[] = [
  {
    id: "volume",
    label: "Volume",
    metrics: [
      { id: "gebeld", short: "Gebeld", color: "#0284c7" },
      { id: "ingepland", short: "Ingepland", color: "#059669" },
    ],
  },
  {
    id: "conversie",
    label: "Conversie",
    metrics: [
      {
        id: "convGebeldIngepland",
        short: "Gebeld → ingepland",
        color: "#0d9488",
        percent: true,
      },
      {
        id: "convBereiktIngepland",
        short: "Bereikt → ingepland",
        color: "#7c3aed",
        percent: true,
      },
      {
        id: "convBereiktNegatief",
        short: "Bereikt → negatief",
        color: "#e11d48",
        percent: true,
      },
      {
        id: "convGebeldNietBereikt",
        short: "Gebeld → niet bereikt",
        color: "#d97706",
        percent: true,
      },
    ],
  },
  {
    id: "uitval_na_inplannen",
    label: "Uitval na inplannen",
    metrics: [
      {
        id: "uitvalH3",
        short: "Binnen 3u na inplannen",
        color: "#be123c",
        percent: true,
      },
      {
        id: "uitvalD3",
        short: "Binnen 3d na inplannen",
        color: "#ea580c",
        percent: true,
      },
      {
        id: "uitvalD7",
        short: "Binnen 7d na inplannen",
        color: "#a16207",
        percent: true,
      },
    ],
  },
  {
    id: "uitval_voor_bezoek",
    label: "Uitval vóór bezoek",
    metrics: [
      {
        id: "lateUitval3u",
        short: "Binnen 3u vóór bezoek",
        color: "#9f1239",
        percent: true,
      },
      {
        id: "lateUitval24u",
        short: "Binnen 24u vóór bezoek",
        color: "#c2410c",
        percent: true,
      },
    ],
  },
];

const TREND_METRICS: BelTrendMetric[] = TREND_METRIC_CATEGORIES.flatMap(
  (c) => c.metrics
);

function pctOrZero(value: number, base: number): number {
  const pct = safeDiv(value, base);
  return pct == null ? 0 : round2(pct * 100);
}

function trendValue(point: BelSeriesPoint, id: BelTrendMetricId): number {
  const bereikt = point.ingepland + point.geenInteresse;
  const nietBereikt = Math.max(0, point.gebeld - bereikt);
  switch (id) {
    case "gebeld":
      return point.gebeld;
    case "ingepland":
      return point.ingepland;
    case "convGebeldIngepland":
      return pctOrZero(point.ingepland, point.gebeld);
    case "convBereiktIngepland":
      return pctOrZero(point.ingepland, bereikt);
    case "convBereiktNegatief":
      return pctOrZero(point.geenInteresse, bereikt);
    case "convGebeldNietBereikt":
      return pctOrZero(nietBereikt, point.gebeld);
    case "uitvalH3":
      return pctOrZero(point.uitvalH3Geannuleerd, point.uitvalH3Rijp);
    case "uitvalD3":
      return pctOrZero(point.uitvalD3Geannuleerd, point.uitvalD3Rijp);
    case "uitvalD7":
      return pctOrZero(point.uitvalD7Geannuleerd, point.uitvalD7Rijp);
    case "lateUitval3u":
      return pctOrZero(point.lateUitval3uGeannuleerd, point.lateUitval3uRijp);
    case "lateUitval24u":
      return pctOrZero(
        point.lateUitval24uGeannuleerd,
        point.lateUitval24uRijp
      );
  }
}

function formatTrendValue(value: number, percent?: boolean): string {
  if (percent) {
    return `${value.toLocaleString("nl-NL", {
      maximumFractionDigits: 1,
    })}%`;
  }
  return value.toLocaleString("nl-NL");
}

const TREND_PERIODS: { id: TrendPeriodId; label: string }[] = [
  { id: "d30", label: "Laatste 30 dagen" },
  { id: "d90", label: "Laatste 90 dagen" },
  { id: "w8", label: "Laatste 8 weken" },
  { id: "w12", label: "Laatste 12 weken" },
  { id: "w26", label: "Laatste 26 weken" },
  { id: "deze_maand", label: "Deze maand" },
  { id: "vorige_maand", label: "Vorige maand" },
  { id: "dit_jaar", label: "Dit jaar" },
  { id: "vrij", label: "Aangepaste periode" },
];

const TREND_GROUPS: { id: GroupBy; label: string }[] = [
  { id: "dag", label: "Per dag" },
  { id: "week", label: "Per week" },
  { id: "maand", label: "Per maand" },
];

function selectClassName() {
  return "h-9 rounded-xl border border-line bg-white px-3 text-sm font-medium text-ink shadow-sm outline-none transition focus:border-green/40 focus:ring-2 focus:ring-green/20";
}

function formatSharePct(value: number, base: number): string {
  if (base <= 0) return "—";
  const pct = safeDiv(value, base);
  if (pct == null) return "—";
  return `${round2(pct * 100).toLocaleString("nl-NL", {
    maximumFractionDigits: 1,
  })}%`;
}

/** Bereikt = negatief of ingepland → conversie naar ingepland. */
function bereiktNaarIngeplandPct(m: BelMetrics): number | null {
  const bereikt = m.ingepland + m.geenInteresse;
  const pct = safeDiv(m.ingepland, bereikt);
  return pct == null ? null : round2(pct * 100);
}

function periodPieData(period: BelPeriodSnapshot) {
  const m = period.current;
  const accounted = m.ingepland + m.geenInteresse + m.geenContact;
  const overig = Math.max(0, m.gebeld - accounted);
  const slices = PIE_SLICES.map((s) => ({
    label: s.label,
    value: m[s.key],
    color: s.color,
  }));
  if (overig > 0) {
    slices.push({
      label: "Overig",
      value: overig,
      color: "#a1a1aa",
    });
  }
  return slices;
}

/** Gem. belpogingen per dag waarop er daadwerkelijk gebeld is. */
function avgGebeldPerBeldag(
  series: BelSeriesPoint[],
  range: DateRange
): { avg: number | null; beldagen: number; totaal: number } {
  const days = series.filter(
    (p) => p.key >= range.from && p.key <= range.to && p.gebeld > 0
  );
  const beldagen = days.length;
  const totaal = days.reduce((s, d) => s + d.gebeld, 0);
  if (beldagen <= 0) return { avg: null, beldagen: 0, totaal: 0 };
  return {
    avg: round2(totaal / beldagen),
    beldagen,
    totaal,
  };
}

function PeriodCard({
  period,
  series,
}: {
  period: BelPeriodSnapshot;
  series: BelSeriesPoint[];
}) {
  const conv = bereiktNaarIngeplandPct(period.current);
  const pieData = periodPieData(period);
  const gebeld = period.current.gebeld;
  const bereikt =
    period.current.ingepland + period.current.geenInteresse;
  const perBeldag =
    period.id === "week" ||
    period.id === "maand" ||
    period.id === "vorige_maand"
      ? avgGebeldPerBeldag(series, period.range)
      : null;

  return (
    <UiCard size="sm" className="bg-white shadow-sm">
      <CardHeader className="border-b">
        <CardTitle className="font-display text-base font-semibold">
          {period.label}
        </CardTitle>
        <CardDescription className="text-xs">
          {formatRangeLabel(period.range)}
        </CardDescription>
        <CardAction>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {perBeldag ? (
              <UiBadge
                variant="outline"
                className="tabular-nums"
                title={
                  perBeldag.avg == null
                    ? "Geen beldagen"
                    : `${perBeldag.totaal} belpogingen ÷ ${perBeldag.beldagen} beldagen`
                }
              >
                {perBeldag.avg == null
                  ? "Gebeld Ø —/dag"
                  : `Gebeld Ø ${perBeldag.avg.toLocaleString("nl-NL", {
                      maximumFractionDigits: 1,
                    })}/dag`}
              </UiBadge>
            ) : null}
            <UiBadge
              variant="secondary"
              className="tabular-nums"
              title="Ingepland ÷ bereikt (bereikt = negatief of ingepland)"
            >
              {conv != null
                ? `B→I ${conv.toLocaleString("nl-NL", {
                    maximumFractionDigits: 1,
                  })}%`
                : "B→I —"}
            </UiBadge>
          </div>
        </CardAction>
      </CardHeader>

      <UiCardContent className="space-y-3">
        <div className="mx-auto h-48 w-full max-w-[220px]">
          <DistributionPieChart
            data={pieData}
            innerRadius={48}
            outerRadius={78}
            centerLabel="gebeld"
            centerValue={gebeld}
            formatValue={(v) => v.toLocaleString("nl-NL")}
          />
        </div>

        <ul className="space-y-1.5">
          {LEGEND_ROWS.map((row) => {
            const value = period.current[row.key];
            const share =
              row.key === "ingepland" || row.key === "geenInteresse"
                ? formatSharePct(value, bereikt)
                : formatSharePct(value, gebeld);
            return (
              <li key={row.key} className="flex items-center gap-2 text-sm">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: row.color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {row.label}
                </span>
                <span className="font-semibold tabular-nums text-foreground">
                  {value.toLocaleString("nl-NL")}
                </span>
                <span
                  className="w-14 text-right text-xs tabular-nums text-muted-foreground"
                  title={
                    row.key === "ingepland" || row.key === "geenInteresse"
                      ? "Van bereikte leads"
                      : "Van belpogingen"
                  }
                >
                  {share}
                </span>
              </li>
            );
          })}
        </ul>
      </UiCardContent>
    </UiCard>
  );
}

function MetricSelectDropdown({
  metrics,
  onToggle,
}: {
  metrics: BelTrendMetricId[];
  onToggle: (id: BelTrendMetricId) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const label =
    metrics.length === 0
      ? "Geen metrics"
      : metrics.length === 1
        ? TREND_METRICS.find((m) => m.id === metrics[0])?.short || "1 metric"
        : `${metrics.length} metrics`;

  return (
    <div ref={rootRef} className="relative min-w-[14rem]">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
        Metrics
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          selectClassName(),
          "mt-1 flex w-full items-center justify-between gap-2"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted transition",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 max-h-80 w-[18rem] overflow-auto rounded-xl border border-line bg-white p-2 shadow-lg">
          {TREND_METRIC_CATEGORIES.map((cat) => (
            <div key={cat.id} className="mb-2 last:mb-0">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                {cat.label}
              </p>
              <ul className="space-y-0.5">
                {cat.metrics.map((m) => {
                  const on = metrics.includes(m.id);
                  return (
                    <li key={m.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-wash">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => onToggle(m.id)}
                          className="size-3.5 rounded border-line text-green accent-emerald-600"
                        />
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: m.color }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate text-ink">
                          {m.short}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BelTrendSection({
  overview,
}: {
  overview: BelCockpitOverview;
}) {
  const [period, setPeriod] = useState<TrendPeriodId>("w12");
  const [group, setGroup] = useState<GroupBy>("dag");
  const [metrics, setMetrics] = useState<BelTrendMetricId[]>([
    "gebeld",
    "ingepland",
    "uitvalH3",
    "lateUitval24u",
  ]);
  const [customFrom, setCustomFrom] = useState(overview.seriesFrom);
  const [customTo, setCustomTo] = useState(overview.seriesTo);

  const range = useMemo(() => {
    if (period === "vrij" && isYmd(customFrom) && isYmd(customTo)) {
      return customFrom <= customTo
        ? { from: customFrom, to: customTo }
        : { from: customTo, to: customFrom };
    }
    return trendPeriodRange(period, overview.todayYmd);
  }, [period, customFrom, customTo, overview.todayYmd]);

  // Auto-interval bij periodewissel (zelfde gedrag als cockpit).
  useEffect(() => {
    setGroup(defaultGroupBy(range));
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  const points = useMemo(
    () => buildBelTrendSeries(overview.series, range, group),
    [overview.series, range, group]
  );

  const selectedMetas = TREND_METRICS.filter((m) => metrics.includes(m.id));
  const hasPercent = selectedMetas.some((m) => m.percent);
  const hasCount = selectedMetas.some((m) => !m.percent);
  const dualAxis = hasPercent && hasCount;

  const chartData = points.map((p) => {
    const row: Record<string, string | number> = { label: p.label };
    for (const m of selectedMetas) {
      row[m.id] = trendValue(p, m.id);
    }
    // Teller/noemer voor uitval-tooltips.
    if (metrics.includes("uitvalH3")) {
      row.uitvalH3Geannuleerd = p.uitvalH3Geannuleerd;
      row.uitvalH3Rijp = p.uitvalH3Rijp;
    }
    if (metrics.includes("uitvalD3")) {
      row.uitvalD3Geannuleerd = p.uitvalD3Geannuleerd;
      row.uitvalD3Rijp = p.uitvalD3Rijp;
    }
    if (metrics.includes("uitvalD7")) {
      row.uitvalD7Geannuleerd = p.uitvalD7Geannuleerd;
      row.uitvalD7Rijp = p.uitvalD7Rijp;
    }
    if (metrics.includes("lateUitval3u")) {
      row.lateUitval3uGeannuleerd = p.lateUitval3uGeannuleerd;
      row.lateUitval3uRijp = p.lateUitval3uRijp;
    }
    if (metrics.includes("lateUitval24u")) {
      row.lateUitval24uGeannuleerd = p.lateUitval24uGeannuleerd;
      row.lateUitval24uRijp = p.lateUitval24uRijp;
    }
    return row;
  });
  const series: ChartSeries[] = selectedMetas.map((m) => ({
    key: m.id,
    label: m.short,
    color: m.color,
    yAxisId: dualAxis ? (m.percent ? "right" : "left") : undefined,
  }));
  const latest = points[points.length - 1];

  function toggleMetric(id: BelTrendMetricId) {
    if (metrics.includes(id)) {
      if (metrics.length === 1) return;
      setMetrics(metrics.filter((m) => m !== id));
      return;
    }
    setMetrics([...metrics, id]);
  }

  return (
    <section className="space-y-4" aria-labelledby="bel-trends-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="bel-trends-heading"
            className="font-display text-lg font-semibold text-green-deeper"
          >
            Trends
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {formatRangeLabel(range)}
            {" · "}
            {TREND_GROUPS.find((g) => g.id === group)?.label || group}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[11rem] flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Periode
            </span>
            <select
              value={period}
              onChange={(e) => {
                const next = e.target.value as TrendPeriodId;
                if (!TREND_PERIOD_IDS.has(next)) return;
                setPeriod(next);
              }}
              className={selectClassName()}
            >
              {TREND_PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {period === "vrij" ? (
            <>
              <label className="flex min-w-[9.5rem] flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  Van
                </span>
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (!isYmd(next)) return;
                    setCustomFrom(next);
                  }}
                  className={selectClassName()}
                  aria-label="Trendperiode van"
                />
              </label>
              <label className="flex min-w-[9.5rem] flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  Tot
                </span>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (!isYmd(next)) return;
                    setCustomTo(next);
                  }}
                  className={selectClassName()}
                  aria-label="Trendperiode tot"
                />
              </label>
            </>
          ) : null}
          <label className="flex min-w-[9rem] flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Interval
            </span>
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value as GroupBy)}
              className={selectClassName()}
            >
              {TREND_GROUPS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <MetricSelectDropdown metrics={metrics} onToggle={toggleMetric} />
        </div>
      </div>

      <Card className="border-line shadow-sm">
        <CardContent className="space-y-4 pt-5">
          {selectedMetas.length > 0 && latest ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {selectedMetas.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-line bg-wash/50 px-3 py-2.5"
                >
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: m.color }}
                    />
                    {m.short}
                  </p>
                  <p className="mt-1 font-display text-xl font-semibold tabular-nums text-ink">
                    {formatTrendValue(trendValue(latest, m.id), m.percent)}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="h-64 w-full sm:h-80">
            <DualAreaChart
              data={chartData}
              xKey="label"
              series={series}
              allowDecimals={hasPercent && !hasCount}
              yWidth={36}
              yWidthRight={40}
              formatValue={(value, key, row) => {
                const meta = TREND_METRICS.find((m) => m.id === key);
                const pct = formatTrendValue(value, meta?.percent);
                const uitvalCounts: Record<
                  string,
                  { geannuleerd: string; rijp: string; unit: string }
                > = {
                  uitvalH3: {
                    geannuleerd: "uitvalH3Geannuleerd",
                    rijp: "uitvalH3Rijp",
                    unit: "ingepland",
                  },
                  uitvalD3: {
                    geannuleerd: "uitvalD3Geannuleerd",
                    rijp: "uitvalD3Rijp",
                    unit: "ingepland",
                  },
                  uitvalD7: {
                    geannuleerd: "uitvalD7Geannuleerd",
                    rijp: "uitvalD7Rijp",
                    unit: "ingepland",
                  },
                  lateUitval3u: {
                    geannuleerd: "lateUitval3uGeannuleerd",
                    rijp: "lateUitval3uRijp",
                    unit: "afspraken",
                  },
                  lateUitval24u: {
                    geannuleerd: "lateUitval24uGeannuleerd",
                    rijp: "lateUitval24uRijp",
                    unit: "afspraken",
                  },
                };
                const counts = uitvalCounts[key];
                if (counts) {
                  const geannuleerd = Number(row?.[counts.geannuleerd] ?? 0);
                  const rijp = Number(row?.[counts.rijp] ?? 0);
                  return `${pct} · ${geannuleerd.toLocaleString("nl-NL")} van ${rijp.toLocaleString("nl-NL")} ${counts.unit}`;
                }
                return pct;
              }}
              formatAxis={(value) => String(Math.round(value))}
              formatAxisRight={(value) => `${Math.round(value)}%`}
            />
          </div>
          <p className="text-xs text-muted">
            Bereikt = negatief of ingepland · niet bereikt = gebeld − bereikt ·
            uitval vóór bezoek alleen op afspraken met start_at ≤ nu
            {dualAxis ? " · aantallen links, % rechts" : ""}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

const LEADERBOARD_PERIODS: {
  id: BelLeaderboardPeriodId;
  label: string;
}[] = [
  { id: "vandaag", label: "Vandaag" },
  { id: "week", label: "Deze week" },
  { id: "maand", label: "Deze maand" },
];

function BelLeaderboardSection({
  overview,
}: {
  overview: BelCockpitOverview;
}) {
  const [periodId, setPeriodId] = useState<BelLeaderboardPeriodId>("week");
  const period = overview.periods.find((p) => p.id === periodId);
  const rows = overview.leaderboards?.[periodId] || [];

  const columns: DataColumn<BelLeaderboardRow & { rank: number }>[] = [
    {
      key: "rank",
      header: "#",
      render: (row) => {
        const top =
          row.rank === 1
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : row.rank === 2
              ? "border-zinc-200 bg-zinc-100 text-zinc-700"
              : row.rank === 3
                ? "border-orange-200 bg-orange-50 text-orange-800"
                : "border-transparent bg-zinc-50 text-zinc-500";
        return (
          <span
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
              top
            )}
          >
            {row.rank === 1 ? (
              <Trophy className="size-3.5" aria-hidden />
            ) : (
              row.rank
            )}
          </span>
        );
      },
    },
    {
      key: "naam",
      header: "Beller",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar
            className={cn(
              "size-8",
              row.rank === 1 && "ring-2 ring-amber-300 ring-offset-1",
              row.rank === 2 && "ring-2 ring-zinc-300 ring-offset-1",
              row.rank === 3 && "ring-2 ring-orange-300 ring-offset-1"
            )}
          >
            <AvatarFallback
              className={cn(
                row.rank === 1 && "bg-amber-50 text-amber-800",
                row.rank === 2 && "bg-zinc-100 text-zinc-700",
                row.rank === 3 && "bg-orange-50 text-orange-800"
              )}
            >
              {initials(row.naam)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.naam}</p>
            {row.rank <= 3 ? (
              <p className="text-[11px] text-muted">
                {row.rank === 1 ? "Koploper" : `Top ${row.rank}`}
              </p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "ingepland",
      header: "Ingepland",
      align: "right",
      render: (row) =>
        row.ingepland > 0 ? (
          <Badge tone="teal" className="rounded-full font-semibold">
            {row.ingepland.toLocaleString("nl-NL")}
          </Badge>
        ) : (
          <span className="tabular-nums text-muted">0</span>
        ),
    },
    {
      key: "belpogingen",
      header: "Belpogingen / bereikt",
      align: "right",
      render: (row) => (
        <div className="inline-flex flex-col items-end gap-1">
          <span className="tabular-nums">
            <span className="font-medium text-ink">{row.gebeld}</span>
            <span className="text-muted"> / </span>
            <span className="font-medium text-ink">{row.bereikt}</span>
          </span>
          <MiniBar
            value={row.bereikt}
            max={Math.max(row.gebeld, 1)}
            colorClass="bg-sky-500"
          />
        </div>
      ),
    },
    {
      key: "convBereiktIngepland",
      header: "% bereikt → ingepland",
      align: "right",
      render: (row) => <ConvCell pct={row.convBereiktIngepland} />,
    },
    {
      key: "convGebeldNietBereikt",
      header: "% niet bereikt",
      align: "right",
      render: (row) => <ConvCell pct={row.convGebeldNietBereikt} />,
    },
  ];

  const ranked = rows.map((row, index) => ({ ...row, rank: index + 1 }));

  return (
    <section className="space-y-4" aria-labelledby="bel-leaderboard-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="bel-leaderboard-heading"
            className="font-display text-lg font-semibold text-green-deeper"
          >
            Leaderboard
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Actieve bellers
            {period ? ` · ${formatRangeLabel(period.range)}` : ""}
            {" · "}
            gesorteerd op ingepland
          </p>
        </div>
        <label className="flex min-w-[11rem] flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Periode
          </span>
          <select
            value={periodId}
            onChange={(e) =>
              setPeriodId(e.target.value as BelLeaderboardPeriodId)
            }
            className={selectClassName()}
          >
            {LEADERBOARD_PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Card className="overflow-hidden border-line shadow-sm">
        <DataTable
          columns={columns}
          rows={ranked}
          rowKey={(row) => row.id}
          empty="Geen actieve bellers"
        />
      </Card>
    </section>
  );
}

export function BelRapportageSection() {
  const [data, setData] = useState<BelCockpitOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/sales-cockpit/bel-rapportage");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Laden mislukt");
        if (!cancelled) setData(json as BelCockpitOverview);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Laden mislukt");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-56 rounded-lg" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <UiCard className="bg-rose-50 ring-rose-200">
        <UiCardContent className="text-sm text-rose-800">{error}</UiCardContent>
      </UiCard>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">
          Bel rapportage
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Per periode de verdeling van uitkomsten. Ingepland en negatief als
          aandeel van bereikte leads; geen contact van belpogingen.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.periods.map((period) => (
          <PeriodCard
            key={period.id}
            period={period}
            series={data.series}
          />
        ))}
      </div>

      <BelTrendSection overview={data} />
      <BelLeaderboardSection overview={data} />
    </div>
  );
}

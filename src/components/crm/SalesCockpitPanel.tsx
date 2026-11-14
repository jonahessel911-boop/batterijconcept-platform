"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileText,
  Handshake,
  Info,
  MapPin,
  Menu,
  Moon,
  Phone,
  Radio,
  Send,
  Sun,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/crm/sales-cockpit/ui/badge";
import { Button } from "@/components/crm/sales-cockpit/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/crm/sales-cockpit/ui/card";
import { Progress } from "@/components/crm/sales-cockpit/ui/progress";
import { Skeleton } from "@/components/crm/sales-cockpit/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/crm/sales-cockpit/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/crm/sales-cockpit/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/crm/sales-cockpit/ui/avatar";
import { DualAreaChart, type ChartSeries } from "@/components/crm/sales-cockpit/ui/charts";
import { DataTable, type DataColumn } from "@/components/crm/sales-cockpit/ui/data-table";
import { AMSTERDAM_TZ, formatEuro } from "@/lib/format";
import type {
  DayAdvisorAppt,
  DayAdvisorRow,
  DayOfferSignal,
  DayOverview,
  SalesQualityAdvisorRow,
  SalesQualityOverview,
  TrendPoint,
  WeekLeaderboardRow,
  WeekOverview,
} from "@/lib/sales-cockpit/cockpit-metrics";
import type { WallboardOverview } from "@/lib/sales-cockpit/wallboard";
import {
  addYmd,
  defaultGroupBy,
  isYmd,
  QUALITY_PERIOD_IDS,
  qualityPeriodRange,
  todayYmd,
  trendPeriodRange,
  TREND_PERIOD_IDS,
  type GroupBy,
  type QualityPeriodId,
  type TrendPeriodId,
} from "@/lib/sales-cockpit/range";
import { cn } from "@/lib/cn";
import { SalesCockpitWall } from "@/components/crm/SalesCockpitWall";
import { MONEY_SOUNDS } from "@/components/crm/SaleCelebrationOverlay";

type AdvisorOption = {
  id: string;
  naam: string;
  actief: boolean;
};

type Report = {
  weekOverview: WeekOverview;
  dayOverview?: DayOverview;
  wallboard?: WallboardOverview;
  weekTrend: TrendPoint[];
  weekLeaderboard?: WeekLeaderboardRow[];
  salesQuality?: SalesQualityOverview;
  trend?: {
    from: string;
    to: string;
    label: string;
    group: GroupBy;
    advisorIds?: string[];
  };
  options?: {
    advisors?: AdvisorOption[];
  };
};

type OverviewMode = "week" | "dag" | "live";
type CockpitTheme = "light" | "dark";

const THEME_KEY = "bc_sales_cockpit_theme_v1";

type TrendMetricId =
  | "deals"
  | "aanbetalingenInc"
  | "orderwaardeEx"
  | "ingepland"
  | "gelopen"
  | "conversionGelopenSalePct"
  | "advisorsActive"
  | "availableBlocks"
  | "capacityFillPct";

const TREND_METRICS: {
  id: TrendMetricId;
  label: string;
  short: string;
  color: string;
  money?: boolean;
  percent?: boolean;
}[] = [
  { id: "deals", label: "Deals", short: "Deals", color: "#0f766e" },
  {
    id: "aanbetalingenInc",
    label: "Hoeveelheid aanbetalingen ontvangen",
    short: "Aanbetalingen",
    color: "#0d9488",
    money: true,
  },
  {
    id: "orderwaardeEx",
    label: "Orderwaarde",
    short: "Orderwaarde",
    color: "#047857",
    money: true,
  },
  {
    id: "ingepland",
    label: "Afspraken ingepland",
    short: "Ingepland",
    color: "#2563eb",
  },
  {
    id: "gelopen",
    label: "Afspraken gelopen",
    short: "Gelopen",
    color: "#059669",
  },
  {
    id: "conversionGelopenSalePct",
    label: "Conversie gelopen → deal",
    short: "Conversie",
    color: "#c2410c",
    percent: true,
  },
  {
    id: "advisorsActive",
    label: "Adviseurs actief",
    short: "Adviseurs",
    color: "#0284c7",
  },
  {
    id: "availableBlocks",
    label: "Beschikbare capaciteit / beschikbare blokken",
    short: "Capaciteit",
    color: "#7c3aed",
  },
  {
    id: "capacityFillPct",
    label: "Vulpercentage capaciteit",
    short: "Vulling",
    color: "#0e7490",
    percent: true,
  },
];

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

const METRIC_IDS = new Set(TREND_METRICS.map((m) => m.id));

function parseTrendMetrics(raw: string | null): TrendMetricId[] {
  const list = (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is TrendMetricId => METRIC_IDS.has(s as TrendMetricId));
  return list.length > 0 ? list : ["deals"];
}

const VIEWS = [
  ["cockpit", "Cockpit"],
  ["kwaliteit", "Kwaliteit"],
] as const;

const QUALITY_PERIODS: { id: QualityPeriodId; label: string }[] = [
  { id: "deze_week", label: "Deze week" },
  { id: "vorige_week", label: "Vorige week" },
  { id: "deze_maand", label: "Deze maand" },
  { id: "vorige_maand", label: "Vorige maand" },
  { id: "d30", label: "Laatste 30 dagen" },
  { id: "d90", label: "Laatste 90 dagen" },
  { id: "dit_jaar", label: "Dit jaar" },
  { id: "vrij", label: "Aangepaste periode" },
];

function pctOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function pctLabel(value: number | null): string {
  return value == null ? "—" : `${value.toLocaleString("nl-NL")}%`;
}

function avgLabel(value: number | null): string {
  return value == null
    ? "—"
    : value.toLocaleString("nl-NL", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      });
}

function MetricHint({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md text-left text-sm text-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-green/30"
        >
          {label}
          <Info className="size-3.5 shrink-0 opacity-60" aria-hidden />
          <span className="sr-only">Meer info</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{tip}</TooltipContent>
    </Tooltip>
  );
}

function compactEuro(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `€${(value / 1_000_000).toLocaleString("nl-NL", {
      maximumFractionDigits: 1,
    })}m`;
  }
  if (Math.abs(value) >= 10_000) {
    return `€${Math.round(value / 1000).toLocaleString("nl-NL")}k`;
  }
  return formatEuro(value);
}

function selectClassName() {
  return "h-9 rounded-xl border border-line bg-white px-3 text-sm font-medium text-ink shadow-sm outline-none transition focus:border-green/40 focus:ring-2 focus:ring-green/20";
}

function WeekTrendSection({
  points,
  period,
  group,
  metrics,
  rangeLabel,
  customFrom,
  customTo,
  advisors,
  selectedAdvisorIds,
  onPeriodChange,
  onGroupChange,
  onMetricsChange,
  onCustomRangeChange,
  onAdvisorIdsChange,
}: {
  points: TrendPoint[];
  period: TrendPeriodId;
  group: GroupBy;
  metrics: TrendMetricId[];
  rangeLabel?: string;
  customFrom: string;
  customTo: string;
  advisors: AdvisorOption[];
  selectedAdvisorIds: string[];
  onPeriodChange: (id: TrendPeriodId) => void;
  onGroupChange: (id: GroupBy) => void;
  onMetricsChange: (ids: TrendMetricId[]) => void;
  onCustomRangeChange: (from: string, to: string) => void;
  onAdvisorIdsChange: (ids: string[]) => void;
}) {
  const selectedMetas = TREND_METRICS.filter((m) => metrics.includes(m.id));
  const hasMoney = selectedMetas.some((m) => m.money);
  const hasPercent = selectedMetas.some((m) => m.percent);
  const hasCount = selectedMetas.some((m) => !m.money && !m.percent);
  const rightKind: "money" | "percent" | null = hasMoney
    ? "money"
    : hasPercent
      ? "percent"
      : null;
  const dualAxis = Boolean(rightKind && (hasCount || (hasMoney && hasPercent)));
  const activeAdvisors = advisors.filter((a) => a.actief);
  const selectedAdvisorId =
    selectedAdvisorIds.length === 1 ? selectedAdvisorIds[0]! : "";
  const advisorFilterLabel =
    selectedAdvisorId === ""
      ? "Alle adviseurs"
      : activeAdvisors.find((a) => a.id === selectedAdvisorId)?.naam ||
        "1 adviseur";

  const chartData = points.map((p) => {
    const row: Record<string, string | number> = { label: p.label };
    for (const m of selectedMetas) {
      const raw = p[m.id];
      row[m.id] = raw == null ? 0 : Number(raw);
    }
    return row;
  });

  const series: ChartSeries[] = selectedMetas.map((m) => {
    let yAxisId: "left" | "right" | undefined;
    if (dualAxis) {
      if (rightKind === "money") {
        yAxisId = m.money ? "right" : "left";
      } else if (rightKind === "percent") {
        yAxisId = m.percent ? "right" : "left";
      }
    }
    return {
      key: m.id,
      label: m.short,
      color: m.color,
      yAxisId,
    };
  });

  const latest = points[points.length - 1];
  const groupLabel =
    TREND_GROUPS.find((g) => g.id === group)?.label.replace(/^Per /, "") ||
    group;

  function toggleMetric(id: TrendMetricId) {
    if (metrics.includes(id)) {
      if (metrics.length === 1) return;
      onMetricsChange(metrics.filter((m) => m !== id));
      return;
    }
    onMetricsChange([...metrics, id]);
  }

  return (
    <section className="space-y-4" aria-labelledby="cockpit-trends-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="cockpit-trends-heading"
            className="font-display text-lg font-semibold text-green-deeper"
          >
            Trends
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {rangeLabel || `${points.length} periodes`}
            {" · "}
            {TREND_GROUPS.find((g) => g.id === group)?.label || group}
            {" · "}
            {advisorFilterLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[11rem] flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Periode
            </span>
            <select
              value={period}
              onChange={(e) => onPeriodChange(e.target.value as TrendPeriodId)}
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
                    onCustomRangeChange(next, customTo || next);
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
                    onCustomRangeChange(customFrom || next, next);
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
              onChange={(e) => onGroupChange(e.target.value as GroupBy)}
              className={selectClassName()}
            >
              {TREND_GROUPS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          {activeAdvisors.length > 0 ? (
            <label className="flex min-w-[12rem] flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
                Adviseur
              </span>
              <select
                value={selectedAdvisorId}
                onChange={(e) => {
                  const next = e.target.value;
                  onAdvisorIdsChange(next ? [next] : []);
                }}
                className={selectClassName()}
                aria-label="Filter op adviseur"
              >
                <option value="">Alle adviseurs</option>
                {activeAdvisors.map((advisor) => (
                  <option key={advisor.id} value={advisor.id}>
                    {advisor.naam}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      <Card className="border-line shadow-sm">
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap gap-1.5">
            {TREND_METRICS.map((m) => {
              const on = metrics.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMetric(m.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
                    on
                      ? "border-transparent text-white shadow-sm"
                      : "border-line bg-white text-muted hover:bg-wash hover:text-ink"
                  )}
                  style={on ? { backgroundColor: m.color } : undefined}
                  aria-pressed={on}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: on ? "#fff" : m.color }}
                  />
                  {m.short}
                </button>
              );
            })}
          </div>

          {selectedMetas.length > 0 && latest ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {selectedMetas.map((m) => {
                const raw = latest[m.id];
                const value = raw == null ? null : Number(raw);
                return (
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
                      {m.money
                        ? formatEuro(value ?? 0)
                        : m.percent
                          ? pctLabel(value)
                          : (value ?? 0).toLocaleString("nl-NL")}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="h-64 w-full sm:h-80">
            <DualAreaChart
              data={chartData}
              xKey="label"
              series={series}
              allowDecimals={
                (!dualAxis && (hasMoney || hasPercent)) ||
                (dualAxis && rightKind === "percent" && !hasCount)
              }
              yWidth={dualAxis || (!hasMoney && !hasPercent) ? 36 : 52}
              yWidthRight={rightKind === "percent" ? 40 : 52}
              formatValue={(value, key) => {
                const meta = TREND_METRICS.find((m) => m.id === key);
                if (meta?.money) return formatEuro(value);
                if (meta?.percent) return pctLabel(value);
                return value.toLocaleString("nl-NL");
              }}
              formatAxis={(value) => {
                if (dualAxis) return String(Math.round(value));
                if (hasMoney) return compactEuro(value);
                if (hasPercent) return `${Math.round(value)}%`;
                return String(Math.round(value));
              }}
              formatAxisRight={(value) =>
                rightKind === "percent"
                  ? `${Math.round(value)}%`
                  : compactEuro(value)
              }
            />
          </div>
          <p className="text-xs text-muted">
            Laatste punt = meest recente {groupLabel.toLowerCase()}
            {dualAxis
              ? rightKind === "percent"
                ? " · aantallen links, conversie % rechts"
                : " · aantallen links, bedragen rechts"
              : ""}
            {hasPercent
              ? " · conversie = gelopen nieuwe huisbezoeken → deal"
              : ""}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

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

function RatioCell({
  n,
  den,
  barColor = "bg-slate-400",
}: {
  n: number;
  den: number;
  barColor?: string;
}) {
  return (
    <div className="inline-flex flex-col items-end gap-1">
      <span className="tabular-nums">
        <span className="font-medium text-ink">{n}</span>
        <span className="text-muted">/{den}</span>
      </span>
      <MiniBar value={n} max={Math.max(den, 1)} colorClass={barColor} />
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
        {pctLabel(pct)}
      </span>
      <MiniBar value={pct ?? 0} colorClass="bg-emerald-600" />
    </div>
  );
}

function WeekLeaderboardSection({
  rows,
  weekLabel,
}: {
  rows: WeekLeaderboardRow[];
  weekLabel?: string;
}) {
  const columns: DataColumn<WeekLeaderboardRow & { rank: number }>[] = [
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
            {row.rank === 1 ? <Trophy className="size-3.5" aria-hidden /> : row.rank}
          </span>
        );
      },
    },
    {
      key: "naam",
      header: "Adviseur",
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
      key: "nieuwGelopen",
      header: "Gelopen nieuw",
      align: "right",
      render: (row) => (
        <RatioCell
          n={row.nieuwGelopen}
          den={row.nieuwIngepland}
          barColor="bg-emerald-500"
        />
      ),
    },
    {
      key: "convNieuw",
      header: "Conv. nieuw",
      align: "right",
      render: (row) => <ConvCell pct={row.conversionNieuwGelopenSalePct} />,
    },
    {
      key: "vervolgGelopen",
      header: "Gelopen vervolg",
      align: "right",
      render: (row) => (
        <RatioCell
          n={row.vervolgGelopen}
          den={row.vervolgIngepland}
          barColor="bg-sky-500"
        />
      ),
    },
    {
      key: "convVervolg",
      header: "Conv. vervolg",
      align: "right",
      render: (row) => <ConvCell pct={row.conversionVervolgGelopenSalePct} />,
    },
    {
      key: "deals",
      header: "Deals",
      align: "right",
      render: (row) =>
        row.deals > 0 ? (
          <Badge tone="teal" className="rounded-full font-semibold">
            {row.deals}
          </Badge>
        ) : (
          <span className="text-muted">0</span>
        ),
    },
    {
      key: "orderwaarde",
      header: "Orderwaarde",
      align: "right",
      render: (row) => (
        <span
          className={cn(
            "tabular-nums",
            row.orderwaardeEx > 0
              ? "font-semibold text-ink"
              : "text-muted"
          )}
        >
          {formatEuro(row.orderwaardeEx)}
        </span>
      ),
    },
  ];

  const ranked = rows.map((row, index) => ({ ...row, rank: index + 1 }));

  return (
    <section className="space-y-4" aria-labelledby="cockpit-leaderboard-heading">
      <div className="min-w-0">
        <h2
          id="cockpit-leaderboard-heading"
          className="font-display text-lg font-semibold text-green-deeper"
        >
          Leaderboard
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          Actieve adviseurs
          {weekLabel ? ` · ${weekLabel}` : ""}
          {" · "}
          gesorteerd op deals
        </p>
      </div>

      <Card className="overflow-hidden border-line shadow-sm">
        <DataTable
          columns={columns}
          rows={ranked}
          rowKey={(row) => row.id}
          empty="Geen actieve adviseurs"
        />
      </Card>
    </section>
  );
}

function VisitCohortPanel({
  title,
  tip,
  badge,
  badgeTone,
  total,
  gelopen,
  open,
  lost,
  conversionPct,
  salesFromGelopen,
  conversionTip,
}: {
  title: string;
  tip: string;
  badge: string;
  badgeTone: "neutral" | "info";
  total: number;
  gelopen: number;
  open: number;
  lost: number;
  conversionPct: number | null;
  salesFromGelopen: number;
  conversionTip: string;
}) {
  const statuses = [
    { label: "Gelopen", n: gelopen, color: "bg-emerald-600" },
    { label: "Nog te lopen", n: open, color: "bg-slate-400" },
    { label: "Niet gelopen", n: lost, color: "bg-amber-500" },
  ];
  const barTotal = gelopen + open + lost;

  return (
    <div className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <MetricHint label={title} tip={tip} />
          <p className="mt-1 text-xs text-muted">
            <span className="font-semibold tabular-nums text-ink">{total}</span>
            {" "}uniek ingepland
          </p>
        </div>
        <Badge tone={badgeTone} className="rounded-full">
          {badge}
        </Badge>
      </div>

      <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3.5 py-3.5">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <MetricHint
              label="Conversie gelopen → deal"
              tip={conversionTip}
            />
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums leading-none text-green-deeper">
              {pctLabel(conversionPct)}
            </p>
            <p className="mt-1.5 text-xs text-muted">
              {gelopen > 0
                ? `${salesFromGelopen} van ${gelopen} gelopen geclosed`
                : "Nog geen gelopen afspraken"}
            </p>
          </div>
          <Badge
            tone={conversionPct != null ? "positive" : "neutral"}
            className="rounded-full font-normal"
          >
            gelopen → deal
          </Badge>
        </div>
        <Progress
          value={conversionPct ?? 0}
          className="mt-3 h-2.5"
          indicatorClassName="bg-emerald-700"
        />
      </div>

      <div className="space-y-2.5">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-zinc-100">
          {barTotal > 0
            ? statuses.map((item) =>
                item.n > 0 ? (
                  <div
                    key={item.label}
                    className={cn("transition-all", item.color)}
                    style={{ width: `${(item.n / barTotal) * 100}%` }}
                    title={`${item.label} ${item.n}`}
                  />
                ) : null
              )
            : null}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {statuses.map((item) => (
            <div key={item.label} className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                <span className={cn("size-1.5 shrink-0 rounded-full", item.color)} />
                {item.label}
              </p>
              <p className="mt-0.5 font-display text-lg font-semibold tabular-nums text-ink">
                {item.n}
              </p>
              <p className="text-[11px] tabular-nums text-muted">
                {total > 0
                  ? `${pctOf(item.n, total).toLocaleString("nl-NL")}% van ingepland`
                  : "—"}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WeekResultCard({ week }: { week: WeekOverview }) {
  const depositPct = week.depositPct;
  const depositLabel =
    week.dealsWithDepositDue > 0
      ? pctLabel(depositPct)
      : week.deals > 0
        ? "n.v.t."
        : "—";
  const depositHint =
    week.dealsWithDepositDue > 0
      ? `${week.dealsDeposited} van ${week.dealsWithDepositDue} deals met vereiste aanbetaling`
      : week.deals > 0
        ? "Geen aanbetaling vereist"
        : "Nog geen deals";

  return (
    <Card className="overflow-hidden border-line border-l-4 border-l-teal-600 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Resultaat deze week</CardTitle>
            <CardDescription>Getekende deals, orderwaarde en aanbetalingen</CardDescription>
          </div>
          <span className="flex size-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <Handshake className="size-4" />
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-wash/40 px-3.5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Deals
            </p>
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums leading-none text-ink">
              {week.deals}
            </p>
            <p className="mt-1.5 text-xs text-muted">
              {week.deals === 1 ? "getekende deal" : "getekende deals"}
            </p>
          </div>

          <div className="rounded-xl border border-line bg-wash/40 px-3.5 py-3">
            <MetricHint
              label="Orderwaarde"
              tip="Som van getekende orderbedragen deze week, exclusief geannuleerde deals."
            />
            <p className="mt-2 font-display text-3xl font-semibold tabular-nums leading-none text-teal-800">
              {formatEuro(week.orderwaardeEx)}
            </p>
            <p className="mt-1.5 text-xs text-muted">
              ex btw · {formatEuro(week.orderwaardeInc)} inc
            </p>
          </div>

          <div className="rounded-xl border border-line bg-wash/40 px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <MetricHint
                label="Aanbetalingen"
                tip="Som van vereiste aanbetalingen (inc. btw) die als volledig ontvangen herkend zijn."
              />
              <Badge
                tone={
                  week.dealsWithDepositDue > 0
                    ? depositPct != null && depositPct >= 80
                      ? "positive"
                      : "teal"
                    : "neutral"
                }
                className="rounded-full font-normal"
              >
                {depositLabel}
              </Badge>
            </div>
            <p className="mt-2 font-display text-3xl font-semibold tabular-nums leading-none text-ink">
              {formatEuro(week.aanbetalingenInc)}
            </p>
            <p className="mt-1.5 text-xs text-muted">{depositHint}</p>
            <Progress
              value={
                depositPct ??
                (week.deals > 0 && week.dealsWithDepositDue === 0 ? 100 : 0)
              }
              className="mt-3 h-2"
              indicatorClassName="bg-teal-600"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatApptTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("nl-NL", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: AMSTERDAM_TZ,
    });
  } catch {
    return "—";
  }
}

function soortShortLabel(soort: string): string {
  if (soort === "nieuw") return "Nieuw";
  if (soort === "vervolg_fysiek") return "Locatie";
  if (soort === "vervolg_tel") return "Telefonisch";
  if (soort === "vervolg_punt") return "Punt";
  return soort || "Afspraak";
}

function offerStatusLabel(appt: DayAdvisorAppt): {
  label: string;
  tone: "positive" | "info" | "neutral";
  Icon: typeof Send;
} {
  const offer = appt.offer;
  if (offer?.signed) {
    return {
      label: "Offerte getekend",
      tone: "positive",
      Icon: CheckCircle2,
    };
  }
  if (offer?.sent) {
    return { label: "Offerte verstuurd", tone: "positive", Icon: Send };
  }
  if (offer?.created) {
    return { label: "Offerte aangemaakt", tone: "info", Icon: FileText };
  }
  return { label: "Geen offerte", tone: "neutral", Icon: FileText };
}

function liveStatusMeta(status: DayAdvisorRow["liveStatus"]): {
  label: string;
  dot: string;
  text: string;
  avatar: string;
  rowBg: string;
} {
  if (status === "in_afspraak") {
    return {
      label: "Nu in afspraak",
      dot: "bg-teal-500",
      text: "text-teal-700",
      avatar: "bg-teal-50 text-teal-800",
      rowBg: "bg-teal-50/40",
    };
  }
  if (status === "vrij") {
    return {
      label: "Vrij · volgende",
      dot: "bg-amber-400",
      text: "text-amber-800",
      avatar: "bg-amber-50 text-amber-900",
      rowBg: "",
    };
  }
  if (status === "volgende") {
    return {
      label: "Volgende",
      dot: "bg-sky-400",
      text: "text-sky-700",
      avatar: "bg-sky-50 text-sky-800",
      rowBg: "",
    };
  }
  return {
    label: "Klaar",
    dot: "bg-zinc-300",
    text: "text-muted",
    avatar: "",
    rowBg: "",
  };
}

function DayAdvisorStatusRow({ row }: { row: DayAdvisorRow }) {
  const inAppt = row.liveStatus === "in_afspraak";
  const status = liveStatusMeta(row.liveStatus);
  const detail = inAppt ? row.current : row.next;
  const offer = detail && inAppt ? offerStatusLabel(detail) : null;

  return (
    <li
      className={cn(
        "grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(11rem,0.9fr)_minmax(0,1.4fr)_auto] sm:items-center sm:gap-4",
        status.rowBg
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative shrink-0">
          <Avatar className="size-9">
            <AvatarFallback className={cn(status.avatar)}>
              {initials(row.naam)}
            </AvatarFallback>
          </Avatar>
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-white",
              status.dot
            )}
            aria-hidden
          />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="truncate font-medium text-ink">{row.naam}</p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                inAppt
                  ? "bg-teal-100 text-teal-800"
                  : row.liveStatus === "vrij"
                    ? "bg-amber-100 text-amber-900"
                    : row.liveStatus === "volgende"
                      ? "bg-sky-100 text-sky-800"
                      : "bg-zinc-100 text-zinc-600"
              )}
            >
              {status.label}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] tabular-nums text-muted">
            {row.openAppts}/{row.apptTotal} open
            {row.nieuw > 0 ? ` · ${row.nieuw} nieuw` : ""}
            {row.vervolgFysiek > 0 ? ` · ${row.vervolgFysiek} locatie` : ""}
            {row.vervolgTel > 0 ? ` · ${row.vervolgTel} tel` : ""}
            {row.vervolgPunt > 0 ? ` · ${row.vervolgPunt} punt` : ""}
          </p>
        </div>
      </div>

      <div className="min-w-0">
        {detail ? (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="inline-flex items-center gap-1.5 font-display text-base font-semibold tabular-nums leading-none text-ink">
                <Clock
                  className={cn(
                    "size-3.5",
                    inAppt ? "text-teal-700" : "text-muted"
                  )}
                  aria-hidden
                />
                {formatApptTime(detail.startAt)}
                <span className="text-sm font-normal text-muted">–</span>
                {formatApptTime(detail.endAt)}
              </span>
              <span className="text-[11px] font-medium text-muted">
                {soortShortLabel(detail.soort)}
              </span>
            </div>
            <p className="mt-1 truncate text-sm text-ink">
              <span className="tabular-nums text-muted">
                {detail.leadNumber}
              </span>
              {detail.leadNaam ? (
                <span className="text-ink"> · {detail.leadNaam}</span>
              ) : null}
            </p>
            {offer ? (
              <p
                className={cn(
                  "mt-1 inline-flex items-center gap-1.5 text-xs font-medium",
                  offer.tone === "positive"
                    ? "text-emerald-700"
                    : offer.tone === "info"
                      ? "text-sky-700"
                      : "text-muted"
                )}
              >
                <offer.Icon className="size-3.5" aria-hidden />
                {offer.label}
              </p>
            ) : null}
            {!inAppt && row.justFinished ? (
              <p className="mt-1 text-xs text-muted">
                Zojuist afgerond: {row.justFinished.leadNumber}
                {row.justFinished.settledLabel
                  ? ` · ${row.justFinished.settledLabel}`
                  : ""}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="min-w-0">
            <p className="text-xs text-muted">
              {row.apptTotal > 0
                ? "Geen openstaande afspraak meer"
                : "Alleen deals, geen afspraken vandaag"}
            </p>
            {row.justFinished ? (
              <p className="mt-1 text-xs text-muted">
                Laatst afgerond: {row.justFinished.leadNumber}
                {row.justFinished.settledLabel
                  ? ` · ${row.justFinished.settledLabel}`
                  : ""}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="shrink-0 text-left sm:min-w-[3.5rem] sm:text-right">
        <p
          className={cn(
            "font-display text-xl font-semibold tabular-nums leading-none",
            row.deals > 0 ? "text-teal-800" : "text-zinc-300"
          )}
        >
          {row.deals}
        </p>
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
          getekend
        </p>
      </div>
    </li>
  );
}

function DayKpiCards({ day }: { day: DayOverview }) {
  const mixParts = [
    { key: "nieuw", label: "Nieuw", n: day.nieuw, color: "bg-emerald-600" },
    {
      key: "locatie",
      label: "Locatie",
      n: day.vervolgFysiek,
      color: "bg-teal-500",
    },
    { key: "tel", label: "Telefonisch", n: day.vervolgTel, color: "bg-sky-500" },
    {
      key: "punt",
      label: "Punt",
      n: day.vervolgPunt,
      color: "bg-zinc-400",
    },
  ].filter((p) => p.n > 0 || p.key !== "punt");
  const mixTotal = Math.max(
    1,
    day.nieuw + day.vervolgFysiek + day.vervolgTel + day.vervolgPunt
  );
  const inApptCount = day.advisors.filter(
    (a) => a.liveStatus === "in_afspraak"
  ).length;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-5">
        <div className="overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-white via-white to-teal-50/40 shadow-sm">
          <div className="grid lg:grid-cols-[1.15fr_1fr]">
            <div className="border-b border-line p-5 sm:p-6 lg:border-b-0 lg:border-r">
              <div className="flex items-center gap-2 text-teal-800">
                <Handshake className="size-4" aria-hidden />
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em]">
                  {day.isToday ? "Resultaat vandaag" : "Resultaat deze dag"}
                </p>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-6">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                    Getekende offertes
                  </p>
                  <p className="mt-2 font-display text-5xl font-semibold tabular-nums leading-none tracking-tight text-ink">
                    {day.deals}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    alle offertes{day.isToday ? " tot nu toe" : ""}
                  </p>
                </div>
                <div>
                  <MetricHint
                    label="Orderwaarde"
                    tip="Som van alle die dag getekende offertes (ex btw), exclusief geannuleerde dossiers."
                  />
                  <p className="mt-2 font-display text-3xl font-semibold tabular-nums leading-none text-teal-800 sm:text-4xl">
                    {formatEuro(day.orderwaardeEx)}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    ex btw · {formatEuro(day.orderwaardeInc)} inc
                  </p>
                </div>
              </div>
            </div>

            <div className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                    Afspraken
                  </p>
                  <p className="mt-2 font-display text-5xl font-semibold tabular-nums leading-none tracking-tight text-ink">
                    {day.apptTotal}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {day.advisorsActive} adviseur
                    {day.advisorsActive === 1 ? "" : "s"}
                    {day.isToday && inApptCount > 0
                      ? ` · ${inApptCount} nu bezig`
                      : " actief"}
                  </p>
                </div>
                <span className="flex size-9 items-center justify-center rounded-xl bg-white text-teal-700 shadow-sm ring-1 ring-line">
                  <Users className="size-4" aria-hidden />
                </span>
              </div>

              <div
                className="mt-5 flex h-2 overflow-hidden rounded-full bg-zinc-100"
                aria-hidden
              >
                {mixParts.map((part) =>
                  part.n > 0 ? (
                    <span
                      key={part.key}
                      className={cn("h-full", part.color)}
                      style={{ width: `${(part.n / mixTotal) * 100}%` }}
                    />
                  ) : null
                )}
              </div>

              <div
                className={cn(
                  "mt-4 grid gap-3",
                  day.vervolgPunt > 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"
                )}
              >
                <div>
                  <p className="text-[11px] text-muted">Nieuw</p>
                  <p className="mt-0.5 font-display text-xl font-semibold tabular-nums text-ink">
                    {day.nieuw}
                  </p>
                </div>
                <div>
                  <p className="flex items-center gap-1 text-[11px] text-muted">
                    <MapPin className="size-3" aria-hidden />
                    Locatie
                  </p>
                  <p className="mt-0.5 font-display text-xl font-semibold tabular-nums text-ink">
                    {day.vervolgFysiek}
                  </p>
                </div>
                <div>
                  <p className="flex items-center gap-1 text-[11px] text-muted">
                    <Phone className="size-3" aria-hidden />
                    Telefonisch
                  </p>
                  <p className="mt-0.5 font-display text-xl font-semibold tabular-nums text-ink">
                    {day.vervolgTel}
                  </p>
                </div>
                {day.vervolgPunt > 0 ? (
                  <div>
                    <p className="text-[11px] text-muted">Punt</p>
                    <p className="mt-0.5 font-display text-xl font-semibold tabular-nums text-ink">
                      {day.vervolgPunt}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-semibold text-green-deeper">
                Adviseurs live
              </h3>
              <p className="mt-0.5 text-sm text-muted">
                {day.isToday
                  ? "Status, huidige of volgende afspraak, en deals vandaag"
                  : "Planning en deals op deze dag"}
              </p>
            </div>
            {day.advisors.length > 0 ? (
              <p className="text-xs tabular-nums text-muted">
                {inApptCount} in afspraak ·{" "}
                {
                  day.advisors.filter((a) => a.liveStatus === "vrij").length
                }{" "}
                vrij ·{" "}
                {
                  day.advisors.filter((a) => a.liveStatus === "volgende")
                    .length
                }{" "}
                volgende ·{" "}
                {day.advisors.filter((a) => a.liveStatus === "klaar").length}{" "}
                klaar
              </p>
            ) : null}
          </div>

          {day.advisors.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-wash/40 px-4 py-10 text-center text-sm text-muted">
              Geen actieve adviseurs met afspraken of deals op deze dag
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
              <ul className="divide-y divide-line">
                {day.advisors.map((row) => (
                  <DayAdvisorStatusRow key={row.id} row={row} />
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </TooltipProvider>
  );
}

function WeekKpiCards({ week }: { week: WeekOverview }) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        <WeekResultCard week={week} />

        <Card className="border-line shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Afspraken deze week</CardTitle>
            <CardDescription>
              Conversie gelopen → deal per cohort, met status van de ingeplande afspraken
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 lg:grid-cols-2">
              <VisitCohortPanel
                title="Eerste huisbezoeken"
                tip="Unieke leads met een eerste huisbezoek (nieuw) gepland in deze week."
                badge="nieuw"
                badgeTone="neutral"
                total={week.ingepland}
                gelopen={week.gelopen}
                open={week.nogTeLopen}
                lost={week.nietGelopen}
                conversionPct={week.conversionNieuwGelopenSalePct}
                salesFromGelopen={week.salesFromGelopen}
                conversionTip="Aandeel unieke nieuwe huisbezoeken die deze week gelopen zijn én een deal werden."
              />
              <VisitCohortPanel
                title="Vervolgafspraken"
                tip="Unieke leads uit eerdere weken met een vervolgafspraak in deze week."
                badge="uit eerdere week"
                badgeTone="info"
                total={week.vervolgIngepland}
                gelopen={week.vervolgGelopen}
                open={week.vervolgNogTeLopen}
                lost={week.vervolgNietGelopen}
                conversionPct={week.conversionVervolgGelopenSalePct}
                salesFromGelopen={week.vervolgSalesFromGelopen}
                conversionTip="Aandeel unieke vervolgafspraken van leads uit eerdere weken die deze week gelopen zijn én een deal werden."
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-line shadow-sm">
          <CardContent className="space-y-3 py-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                  <Users className="size-3.5" />
                </span>
                <MetricHint
                  label="Capaciteit"
                  tip={`${week.availableBlocksTotal} blokken over ${week.planbaarAdvisors || 0} planbare adviseurs met afspraken deze week. ${week.physicalBooked} fysieke afspraken geboekt. Adviseurs zonder afspraken tellen niet mee.`}
                />
              </div>
              <Badge
                tone={
                  week.capacityFillPct == null
                    ? "neutral"
                    : week.capacityFillPct >= 70
                      ? "positive"
                      : "info"
                }
                className="rounded-full font-normal"
              >
                {pctLabel(week.capacityFillPct)} gevuld
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[11px] text-muted">Adviseurs</p>
                <p className="mt-0.5 font-display text-xl font-semibold tabular-nums text-ink">
                  {week.advisorsWithAppointments}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted">Cap. / adv.</p>
                <p className="mt-0.5 font-display text-xl font-semibold tabular-nums text-ink">
                  {avgLabel(week.avgAvailableBlocksPerAdvisor)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted">Gevuld / adv.</p>
                <p className="mt-0.5 font-display text-xl font-semibold tabular-nums text-sky-800">
                  {avgLabel(week.avgPhysicalBookedPerAdvisor)}
                </p>
              </div>
            </div>
            <Progress
              value={Math.min(100, week.capacityFillPct ?? 0)}
              className="h-2"
              indicatorClassName="bg-sky-600"
            />
            <p className="text-xs text-muted">
              {week.physicalOpen} open · {week.physicalGelopen} gelopen · nieuw +
              fysiek vervolg
            </p>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

function SalesQualitySection({
  quality,
  period,
  customFrom,
  customTo,
  onPeriodChange,
  onCustomRangeChange,
}: {
  quality: SalesQualityOverview | null | undefined;
  period: QualityPeriodId;
  customFrom: string;
  customTo: string;
  onPeriodChange: (id: QualityPeriodId) => void;
  onCustomRangeChange: (from: string, to: string) => void;
}) {
  const columns: DataColumn<SalesQualityAdvisorRow & { rank: number }>[] = [
    {
      key: "rank",
      header: "#",
      render: (row) => (
        <span className="tabular-nums text-muted">{row.rank}</span>
      ),
    },
    {
      key: "naam",
      header: "Adviseur",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarFallback>{initials(row.naam)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.naam}</p>
            {!row.actief ? (
              <p className="text-[11px] text-muted">Inactief</p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "deals",
      header: "Deals",
      align: "right",
      render: (row) => (
        <span className="font-semibold tabular-nums text-ink">{row.deals}</span>
      ),
    },
    {
      key: "aanbetaald",
      header: "Aanbetaald",
      align: "right",
      render: (row) => (
        <RatioCell
          n={row.aanbetaald}
          den={row.dealsWithDepositDue}
          barColor="bg-emerald-500"
        />
      ),
    },
    {
      key: "aanbetaaldPct",
      header: "% aanbetaald",
      align: "right",
      render: (row) => <ConvCell pct={row.aanbetaaldPct} />,
    },
    {
      key: "tijdig",
      header: "Op tijd",
      align: "right",
      render: (row) => (
        <RatioCell
          n={row.tijdig}
          den={row.tijdigBeoordeeld}
          barColor="bg-sky-500"
        />
      ),
    },
    {
      key: "tijdigPct",
      header: "% op tijd",
      align: "right",
      render: (row) => <ConvCell pct={row.tijdigPct} />,
    },
    {
      key: "hold",
      header: "Hold sales",
      align: "right",
      render: (row) =>
        row.hold > 0 ? (
          <div className="inline-flex flex-col items-end gap-1">
            <Badge tone="warn" className="rounded-full font-semibold">
              {row.hold}/{row.deals}
            </Badge>
            <MiniBar
              value={row.hold}
              max={Math.max(row.deals, 1)}
              colorClass="bg-amber-500"
            />
          </div>
        ) : (
          <span className="tabular-nums text-muted">0/{row.deals}</span>
        ),
    },
    {
      key: "holdPct",
      header: "% hold",
      align: "right",
      render: (row) => (
        <span
          className={cn(
            "tabular-nums font-semibold",
            row.holdPct == null
              ? "text-muted"
              : row.holdPct > 0
                ? "text-amber-800"
                : "text-green-deeper"
          )}
        >
          {pctLabel(row.holdPct)}
        </span>
      ),
    },
  ];

  const ranked = (quality?.advisors || []).map((row, index) => ({
    ...row,
    rank: index + 1,
  }));

  return (
    <section className="space-y-5" aria-labelledby="cockpit-quality-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="cockpit-quality-heading"
            className="font-display text-lg font-semibold text-green-deeper"
          >
            Saleskwaliteit
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Aanbetalingen, op tijd (3 dagen na factuur/bel) en hold
            {quality?.label ? ` · ${quality.label}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className={selectClassName()}
            value={period}
            onChange={(e) =>
              onPeriodChange(e.target.value as QualityPeriodId)
            }
            aria-label="Periode"
          >
            {QUALITY_PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {period === "vrij" ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                className={selectClassName()}
                value={customFrom}
                onChange={(e) =>
                  onCustomRangeChange(e.target.value, customTo)
                }
                aria-label="Begindatum"
              />
              <span className="text-xs text-muted">t/m</span>
              <input
                type="date"
                className={selectClassName()}
                value={customTo}
                onChange={(e) =>
                  onCustomRangeChange(customFrom, e.target.value)
                }
                aria-label="Einddatum"
              />
            </div>
          ) : null}
        </div>
      </div>

      {quality ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-line bg-white px-4 py-4 shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Deals
            </p>
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums text-ink">
              {quality.deals}
            </p>
            <p className="mt-1 text-xs text-muted">getekend in periode</p>
          </div>
          <div className="rounded-2xl border border-line bg-white px-4 py-4 shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Aanbetaald
            </p>
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums text-teal-800">
              {quality.aanbetaald}
              <span className="ml-1 text-lg font-medium text-muted">
                /{quality.dealsWithDepositDue}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted">
              {pctLabel(quality.aanbetaaldPct)} van deals met vereiste
              aanbetaling
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-white px-4 py-4 shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Op tijd betaald
            </p>
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums text-sky-800">
              {quality.tijdig}
              <span className="ml-1 text-lg font-medium text-muted">
                /{quality.tijdigBeoordeeld}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted">
              {pctLabel(quality.tijdigPct)} binnen 3 dagen na factuur
              (en bel indien bekend)
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-white px-4 py-4 shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Hold sales actie
            </p>
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums text-amber-800">
              {quality.hold}
              <span className="ml-1 text-lg font-medium text-muted">
                /{quality.deals}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted">
              {pctLabel(quality.holdPct)} van getekende deals
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      )}

      <Card className="overflow-hidden border-line shadow-sm">
        {quality ? (
          <DataTable
            columns={columns}
            rows={ranked}
            rowKey={(row) => row.id}
            empty="Geen getekende deals in deze periode"
          />
        ) : (
          <div className="p-4">
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        )}
      </Card>
    </section>
  );
}

type OfferEventKind = "created" | "sent" | "signed";

type OfferEvent = {
  id: string;
  kind: OfferEventKind;
  adviseurNaam: string;
  leadLabel: string;
};

type AfboekMomentEvent = {
  id: string;
  adviseurNaam: string;
  leadLabel: string;
  uitkomstLabel: string;
};

const DAY_POLL_MS = 8_000;
const TOAST_MS = 4_500;
const SIGNED_CELEBRATION_MS = 6_500;
const OFFER_MOMENT_MS = 7_500;
/** Sobere afboek-melding — korter dan offerte-overlays. */
const AFBOEK_MOMENT_MS = 4_500;
/** Fallback als autoplay geblokkeerd is of ended-event uitblijft. */
const OFFER_SIGNED_FALLBACK_MS = 20_000;

function afboekUitkomstFromTitel(titel: string): string {
  const sep = titel.indexOf("·");
  if (sep >= 0) {
    const part = titel.slice(sep + 1).trim();
    if (part) return part;
  }
  if (titel.startsWith("Status → ")) {
    return titel.slice("Status → ".length).trim() || "Afgeboekt";
  }
  return "Afgeboekt";
}

function offerSignalLevel(signal: DayOfferSignal): number {
  if (signal.signed) return 3;
  if (signal.sent) return 2;
  if (signal.created) return 1;
  return 0;
}

function CockpitConfettiBurst({ dense = false }: { dense?: boolean }) {
  const pieces = Array.from({ length: dense ? 64 : 28 }, (_, i) => i);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {pieces.map((i) => {
        const left = (i * 17 + 7) % 100;
        const delay = (i % 12) * 0.06;
        const dur = 1.7 + (i % 5) * 0.22;
        const size = dense ? 7 + (i % 4) * 3 : 5 + (i % 3) * 2;
        const colors = ["#F5C518", "#FFFFFF", "#14B8A6", "#22C55E", "#38BDF8", "#F97316"];
        const color = colors[i % colors.length];
        return (
          <span
            key={i}
            className="cockpit-confetti absolute top-[-12%] rounded-sm"
            style={{
              left: `${left}%`,
              width: size,
              height: size * (0.55 + (i % 3) * 0.28),
              background: color,
              animationDelay: `${delay}s`,
              animationDuration: `${dur}s`,
              transform: `rotate(${(i * 37) % 360}deg)`,
            }}
          />
        );
      })}
    </div>
  );
}

function OfferToasts({
  items,
  onDismiss,
}: {
  items: OfferEvent[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-xl border bg-white/95 px-3.5 py-3 shadow-lg backdrop-blur",
            item.kind === "sent"
              ? "border-sky-200"
              : "border-line"
          )}
        >
          <span
            className={cn(
              "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
              item.kind === "sent"
                ? "bg-sky-50 text-sky-700"
                : "bg-wash text-muted"
            )}
          >
            {item.kind === "sent" ? (
              <Send className="size-3.5" aria-hidden />
            ) : (
              <FileText className="size-3.5" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">
              {item.kind === "sent" ? "Offerte verstuurd" : "Offerte aangemaakt"}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted">
              {item.adviseurNaam}
              {item.leadLabel ? ` · ${item.leadLabel}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(item.id)}
            className="rounded-md p-1 text-muted hover:bg-wash hover:text-ink"
            aria-label="Sluiten"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function SignedCelebration({
  event,
  onClose,
}: {
  event: OfferEvent;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <style>{`
        @keyframes cockpit-pop-in {
          0% { opacity: 0; transform: scale(0.4) translateY(28px); filter: blur(10px); }
          55% { opacity: 1; transform: scale(1.08) translateY(0); filter: blur(0); }
          100% { opacity: 1; transform: scale(1); filter: blur(0); }
        }
        @keyframes cockpit-flash {
          0% { opacity: 0.75; }
          100% { opacity: 0; }
        }
        @keyframes cockpit-confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0.15; }
        }
        @keyframes cockpit-glow {
          0%, 100% { text-shadow: 0 0 18px rgba(20,184,166,0.45), 0 0 48px rgba(245,197,24,0.25); }
          50% { text-shadow: 0 0 36px rgba(20,184,166,0.85), 0 0 80px rgba(245,197,24,0.4); }
        }
        .cockpit-confetti {
          animation-name: cockpit-confetti-fall;
          animation-timing-function: cubic-bezier(0.22, 0.8, 0.35, 1);
          animation-fill-mode: forwards;
        }
        .cockpit-pop { animation: cockpit-pop-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .cockpit-pop-delay { animation: cockpit-pop-in 0.75s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both; }
        .cockpit-flash { animation: cockpit-flash 0.55s ease-out forwards; }
        .cockpit-glow-text { animation: cockpit-glow 1.3s ease-in-out infinite; }
      `}</style>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <div className="cockpit-flash pointer-events-none absolute inset-0 bg-white" />
      <CockpitConfettiBurst dense />
      <div className="relative mx-4 max-w-[92vw] text-center">
        <p className="cockpit-pop text-sm font-black uppercase tracking-[0.4em] text-teal-300">
          Deal getekend
        </p>
        <p className="cockpit-pop-delay cockpit-glow-text mt-3 font-display text-[clamp(2.4rem,11vw,5.5rem)] font-black leading-[0.95] tracking-tight text-white">
          {event.adviseurNaam}
        </p>
        <p className="cockpit-pop-delay mt-4 inline-flex items-center gap-2 rounded-full bg-teal-500/20 px-4 py-2 text-sm font-semibold text-teal-100 ring-1 ring-teal-300/40">
          <CheckCircle2 className="size-4" aria-hidden />
          Offerte getekend
        </p>
        {event.leadLabel ? (
          <p className="cockpit-pop-delay mt-3 text-base font-medium text-white/80">
            {event.leadLabel}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="absolute bottom-5 right-5 z-10 rounded-lg border border-white/30 bg-black/50 px-3 py-2 text-xs font-semibold text-white backdrop-blur hover:bg-black/70"
      >
        Sluiten
      </button>
    </div>
  );
}

/** Sobere melding wanneer een adviseur een afspraak afboekt (live wall). */
function AfboekMomentOverlay({
  event,
  onClose,
}: {
  event: AfboekMomentEvent;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4">
      <style>{`
        @keyframes afboek-moment-in {
          0% { opacity: 0; transform: translateY(10px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .afboek-moment-card {
          animation: afboek-moment-in 0.28s ease-out both;
        }
      `}</style>
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Sluiten"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-labelledby="afboek-moment-title"
        className="afboek-moment-card relative w-full max-w-md rounded-2xl border border-line bg-[var(--white,#fff)] p-5 shadow-xl"
      >
        <div className="flex items-start gap-3.5">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-800 ring-1 ring-amber-200/80">
            <ClipboardCheck className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              Afspraak afgeboekt
            </p>
            <p
              id="afboek-moment-title"
              className="mt-1 font-display text-xl font-semibold tracking-tight text-ink"
            >
              {event.adviseurNaam}
            </p>
            <p className="mt-1.5 text-sm font-medium text-ink/90">
              {event.uitkomstLabel}
            </p>
            {event.leadLabel ? (
              <p className="mt-0.5 truncate text-sm text-muted">
                {event.leadLabel}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted hover:bg-wash hover:text-ink"
            aria-label="Sluiten"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Fullscreen melding voor offerte aangemaakt/verstuurd op de live wall. */
function OfferMomentOverlay({
  event,
  onClose,
}: {
  event: OfferEvent;
  onClose: () => void;
}) {
  const isSigned = event.kind === "signed";
  const isSent = event.kind === "sent";
  const eyebrow = isSigned
    ? "Offerte getekend"
    : isSent
      ? "Offerte verstuurd"
      : "Offerte aangemaakt";
  const chip = isSigned
    ? "Deal binnen"
    : isSent
      ? "Verstuurd naar klant"
      : "Nieuw offertetraject";
  return (
    <div className="fixed inset-0 z-[92] flex items-center justify-center">
      <style>{`
        @keyframes offer-moment-pop {
          0% { opacity: 0; transform: scale(0.28) translateY(48px); filter: blur(14px); }
          55% { opacity: 1; transform: scale(1.14) translateY(0); filter: blur(0); }
          78% { transform: scale(0.97); }
          100% { opacity: 1; transform: scale(1); filter: blur(0); }
        }
        @keyframes offer-moment-flash {
          0% { opacity: 0.9; }
          100% { opacity: 0; }
        }
        @keyframes offer-moment-glow {
          0%, 100% {
            text-shadow:
              0 0 28px rgba(56,189,248,0.55),
              0 0 70px rgba(20,184,166,0.35),
              0 6px 0 rgba(0,0,0,0.4);
          }
          50% {
            text-shadow:
              0 0 48px rgba(56,189,248,0.95),
              0 0 110px rgba(245,197,24,0.45),
              0 6px 0 rgba(0,0,0,0.4);
          }
        }
        @keyframes offer-moment-shake {
          0%, 100% { transform: translate(0, 0); }
          20% { transform: translate(-12px, 5px); }
          40% { transform: translate(12px, -5px); }
          60% { transform: translate(-8px, 3px); }
          80% { transform: translate(8px, -3px); }
        }
        .offer-moment-root { animation: offer-moment-shake 0.55s ease-out both; }
        .offer-moment-pop { animation: offer-moment-pop 0.75s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .offer-moment-pop-delay { animation: offer-moment-pop 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both; }
        .offer-moment-flash { animation: offer-moment-flash 0.6s ease-out forwards; }
        .offer-moment-glow { animation: offer-moment-glow 1.25s ease-in-out infinite; }
      `}</style>
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-b to-black/80",
          isSigned
            ? "from-amber-950/85 via-black/55"
            : isSent
              ? "from-sky-950/80 via-black/55"
              : "from-teal-950/80 via-black/55"
        )}
      />
      <div className="offer-moment-flash pointer-events-none absolute inset-0 bg-white" />
      <CockpitConfettiBurst dense />
      <div className="offer-moment-root relative mx-4 max-w-[96vw] text-center">
        <p
          className={cn(
            "offer-moment-pop text-[clamp(0.85rem,2.2vw,1.15rem)] font-black uppercase tracking-[0.42em]",
            isSigned
              ? "text-amber-300"
              : isSent
                ? "text-sky-300"
                : "text-teal-300"
          )}
        >
          {eyebrow}
        </p>
        <p className="offer-moment-pop-delay offer-moment-glow mt-4 font-display text-[clamp(3rem,14vw,8rem)] font-black leading-[0.92] tracking-tight text-white">
          {event.adviseurNaam}
        </p>
        <p
          className={cn(
            "offer-moment-pop-delay mt-5 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[clamp(0.95rem,2vw,1.25rem)] font-semibold ring-1",
            isSigned
              ? "bg-amber-500/20 text-amber-100 ring-amber-300/45"
              : isSent
                ? "bg-sky-500/20 text-sky-100 ring-sky-300/45"
                : "bg-teal-500/20 text-teal-100 ring-teal-300/45"
          )}
        >
          {isSigned ? (
            <CheckCircle2 className="size-5" aria-hidden />
          ) : isSent ? (
            <Send className="size-5" aria-hidden />
          ) : (
            <FileText className="size-5" aria-hidden />
          )}
          {chip}
        </p>
        {event.leadLabel ? (
          <p className="offer-moment-pop-delay mt-4 text-[clamp(1.05rem,2.4vw,1.6rem)] font-medium text-white/85">
            {event.leadLabel}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="absolute bottom-5 right-5 z-10 rounded-lg border border-white/30 bg-black/50 px-3 py-2 text-xs font-semibold text-white backdrop-blur hover:bg-black/70"
      >
        Sluiten
      </button>
    </div>
  );
}

export function SalesCockpitPanel({ onOpenMenu }: { onOpenMenu?: () => void }) {
  const sp = useSearchParams();
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveUpdating, setLiveUpdating] = useState(false);
  const [offerToasts, setOfferToasts] = useState<OfferEvent[]>([]);
  const [signedEvent, setSignedEvent] = useState<OfferEvent | null>(null);
  const [offerMoment, setOfferMoment] = useState<OfferEvent | null>(null);
  const [afboekMoment, setAfboekMoment] = useState<AfboekMomentEvent | null>(
    null
  );

  const offerLevelsRef = useRef<Map<string, number>>(new Map());
  const offerBootstrappedRef = useRef(false);
  const offerBootstrapKeyRef = useRef("");
  const signedQueueRef = useRef<OfferEvent[]>([]);
  const celebratingSignedRef = useRef(false);
  const signedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const offerMomentQueueRef = useRef<OfferEvent[]>([]);
  const celebratingOfferMomentRef = useRef(false);
  const offerMomentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const offerMomentAudioRef = useRef<HTMLAudioElement | null>(null);
  const offerMomentSoundEndedRef = useRef<(() => void) | null>(null);
  const offerMomentGenRef = useRef(0);
  const offerMomentSeenRef = useRef<Set<string>>(new Set());
  const offerMomentBootstrappedRef = useRef(false);
  const afboekMomentQueueRef = useRef<AfboekMomentEvent[]>([]);
  const celebratingAfboekMomentRef = useRef(false);
  const afboekMomentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const afboekMomentSeenRef = useRef<Set<string>>(new Set());
  const afboekMomentBootstrappedRef = useRef(false);

  const view = sp.get("view") || "cockpit";
  const overviewRaw = sp.get("overview");
  const overviewMode: OverviewMode =
    overviewRaw === "dag" ? "dag" : overviewRaw === "live" ? "live" : "week";
  const fullscreen = sp.get("fs") === "1";
  const weekParam = sp.get("week");
  const weekAnchor = isYmd(weekParam) ? weekParam : todayYmd();
  const dayParam = sp.get("dag");
  const dayAnchor = isYmd(dayParam) ? dayParam : todayYmd();
  const [theme, setTheme] = useState<CockpitTheme>("light");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === "dark" || stored === "light") setTheme(stored);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
    // Sync naar html zodat shell/viewport/--wash mee kleuren (geen witte rand).
    document.documentElement.setAttribute("data-sales-cockpit-theme", theme);
    return () => {
      document.documentElement.removeAttribute("data-sales-cockpit-theme");
    };
  }, [theme]);

  const trendPeriodRaw = sp.get("trend_periode") || "w12";
  const trendPeriod = TREND_PERIOD_IDS.has(trendPeriodRaw as TrendPeriodId)
    ? (trendPeriodRaw as TrendPeriodId)
    : "w12";
  const trendVanRaw = sp.get("trend_van") || "";
  const trendTotRaw = sp.get("trend_tot") || "";
  const defaultCustom = useMemo(
    () => trendPeriodRange("d30", todayYmd()),
    []
  );
  const trendCustomFrom = isYmd(trendVanRaw) ? trendVanRaw : defaultCustom.from;
  const trendCustomTo = isYmd(trendTotRaw) ? trendTotRaw : defaultCustom.to;
  const trendGroupRaw = sp.get("trend_groep");
  const trendGroup: GroupBy | null =
    trendGroupRaw === "dag" ||
    trendGroupRaw === "week" ||
    trendGroupRaw === "maand"
      ? trendGroupRaw
      : null;
  const trendMetrics = parseTrendMetrics(sp.get("trend_metrics"));
  const trendAdvisorIds = useMemo(
    () =>
      (sp.get("trend_adv") || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    [sp]
  );
  const qualityPeriodRaw = sp.get("kwaliteit_periode") || "deze_maand";
  const qualityPeriod = QUALITY_PERIOD_IDS.has(
    qualityPeriodRaw as QualityPeriodId
  )
    ? (qualityPeriodRaw as QualityPeriodId)
    : "deze_maand";
  const qualityVanRaw = sp.get("kwaliteit_van") || "";
  const qualityTotRaw = sp.get("kwaliteit_tot") || "";
  const defaultQualityCustom = useMemo(
    () => qualityPeriodRange("d30", todayYmd()),
    []
  );
  const qualityCustomFrom = isYmd(qualityVanRaw)
    ? qualityVanRaw
    : defaultQualityCustom.from;
  const qualityCustomTo = isYmd(qualityTotRaw)
    ? qualityTotRaw
    : defaultQualityCustom.to;

  const dataQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("preset", "deze_week");
    params.set("week", weekAnchor);
    params.set("dag", dayAnchor);
    params.set("trend_periode", trendPeriod);
    if (trendPeriod === "vrij") {
      params.set("trend_van", trendCustomFrom);
      params.set("trend_tot", trendCustomTo);
    }
    if (trendGroup) params.set("trend_groep", trendGroup);
    if (trendAdvisorIds.length > 0) {
      params.set("trend_adv", trendAdvisorIds.join(","));
    }
    params.set("kwaliteit_periode", qualityPeriod);
    if (qualityPeriod === "vrij") {
      params.set("kwaliteit_van", qualityCustomFrom);
      params.set("kwaliteit_tot", qualityCustomTo);
    }
    return params.toString();
  }, [
    weekAnchor,
    dayAnchor,
    trendPeriod,
    trendGroup,
    trendCustomFrom,
    trendCustomTo,
    trendAdvisorIds,
    qualityPeriod,
    qualityCustomFrom,
    qualityCustomTo,
  ]);

  const playNextSigned = useCallback(() => {
    const next = signedQueueRef.current.shift();
    if (!next) {
      celebratingSignedRef.current = false;
      setSignedEvent(null);
      return;
    }
    celebratingSignedRef.current = true;
    setSignedEvent(next);
    if (signedTimerRef.current) clearTimeout(signedTimerRef.current);
    signedTimerRef.current = setTimeout(() => {
      playNextSigned();
    }, SIGNED_CELEBRATION_MS);
  }, []);

  const enqueueSigned = useCallback(
    (event: OfferEvent) => {
      signedQueueRef.current.push(event);
      if (!celebratingSignedRef.current) playNextSigned();
    },
    [playNextSigned]
  );

  const stopOfferMomentSound = useCallback(() => {
    const audio = offerMomentAudioRef.current;
    if (audio && offerMomentSoundEndedRef.current) {
      audio.removeEventListener("ended", offerMomentSoundEndedRef.current);
      offerMomentSoundEndedRef.current = null;
    }
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }, []);

  /** Speelt money-sound; roept onComplete aan als de clip klaar is (of play faalt). */
  const playSignedSound = useCallback(
    (onComplete: () => void) => {
      const audio = offerMomentAudioRef.current;
      if (!audio) {
        onComplete();
        return;
      }
      const next =
        MONEY_SOUNDS[Math.floor(Math.random() * MONEY_SOUNDS.length)] ??
        MONEY_SOUNDS[0];
      if (offerMomentSoundEndedRef.current) {
        audio.removeEventListener("ended", offerMomentSoundEndedRef.current);
        offerMomentSoundEndedRef.current = null;
      }
      if (audio.getAttribute("src") !== next) audio.src = next;
      audio.currentTime = 0;
      audio.volume = 1;
      const onEnded = () => {
        offerMomentSoundEndedRef.current = null;
        audio.removeEventListener("ended", onEnded);
        onComplete();
      };
      offerMomentSoundEndedRef.current = onEnded;
      audio.addEventListener("ended", onEnded);
      void audio.play().catch(() => {
        offerMomentSoundEndedRef.current = null;
        audio.removeEventListener("ended", onEnded);
        onComplete();
      });
    },
    []
  );

  const dismissAfboekDisplay = useCallback(() => {
    celebratingAfboekMomentRef.current = false;
    if (afboekMomentTimerRef.current) {
      clearTimeout(afboekMomentTimerRef.current);
      afboekMomentTimerRef.current = null;
    }
    setAfboekMoment(null);
  }, []);

  const playNextAfboekMoment = useCallback(() => {
    if (celebratingOfferMomentRef.current) return;
    if (afboekMomentTimerRef.current) {
      clearTimeout(afboekMomentTimerRef.current);
      afboekMomentTimerRef.current = null;
    }
    const next = afboekMomentQueueRef.current.shift();
    if (!next) {
      celebratingAfboekMomentRef.current = false;
      setAfboekMoment(null);
      return;
    }
    celebratingAfboekMomentRef.current = true;
    setAfboekMoment(next);
    afboekMomentTimerRef.current = setTimeout(() => {
      playNextAfboekMoment();
    }, AFBOEK_MOMENT_MS);
  }, []);

  const enqueueAfboekMoment = useCallback(
    (event: AfboekMomentEvent) => {
      afboekMomentQueueRef.current.push(event);
      if (
        !celebratingAfboekMomentRef.current &&
        !celebratingOfferMomentRef.current
      ) {
        playNextAfboekMoment();
      }
    },
    [playNextAfboekMoment]
  );

  const dismissAfboekMoment = useCallback(() => {
    if (afboekMomentTimerRef.current) {
      clearTimeout(afboekMomentTimerRef.current);
      afboekMomentTimerRef.current = null;
    }
    playNextAfboekMoment();
  }, [playNextAfboekMoment]);

  const playNextOfferMoment = useCallback(() => {
    if (offerMomentTimerRef.current) clearTimeout(offerMomentTimerRef.current);
    stopOfferMomentSound();
    const gen = ++offerMomentGenRef.current;

    const next = offerMomentQueueRef.current.shift();
    if (!next) {
      celebratingOfferMomentRef.current = false;
      setOfferMoment(null);
      playNextAfboekMoment();
      return;
    }
    // Offerte-overlays gaan voor op afboek-meldingen.
    dismissAfboekDisplay();
    celebratingOfferMomentRef.current = true;
    setOfferMoment(next);

    const advance = () => {
      if (offerMomentGenRef.current !== gen) return;
      playNextOfferMoment();
    };

    if (next.kind === "signed") {
      // Overlay blijft tot de sound klaar is.
      playSignedSound(advance);
      offerMomentTimerRef.current = setTimeout(
        advance,
        OFFER_SIGNED_FALLBACK_MS
      );
      return;
    }

    offerMomentTimerRef.current = setTimeout(advance, OFFER_MOMENT_MS);
  }, [
    dismissAfboekDisplay,
    playNextAfboekMoment,
    playSignedSound,
    stopOfferMomentSound,
  ]);

  const enqueueOfferMoment = useCallback(
    (event: OfferEvent) => {
      offerMomentQueueRef.current.push(event);
      if (!celebratingOfferMomentRef.current) playNextOfferMoment();
    },
    [playNextOfferMoment]
  );

  const dismissOfferMoment = useCallback(() => {
    // Handmatig sluiten: invalideer sound-callback en ga door.
    offerMomentGenRef.current += 1;
    if (offerMomentTimerRef.current) clearTimeout(offerMomentTimerRef.current);
    stopOfferMomentSound();
    playNextOfferMoment();
  }, [playNextOfferMoment, stopOfferMomentSound]);

  const pushToast = useCallback((event: OfferEvent) => {
    setOfferToasts((prev) => [...prev.slice(-2), event]);
    const existing = toastTimersRef.current.get(event.id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setOfferToasts((prev) => prev.filter((t) => t.id !== event.id));
      toastTimersRef.current.delete(event.id);
    }, TOAST_MS);
    toastTimersRef.current.set(event.id, timer);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setOfferToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
  }, []);

  const ingestOfferSignals = useCallback(
    (signals: DayOfferSignal[] | undefined, bootstrapKey: string) => {
      const list = signals || [];
      if (offerBootstrapKeyRef.current !== bootstrapKey) {
        offerBootstrappedRef.current = false;
        offerBootstrapKeyRef.current = bootstrapKey;
        offerLevelsRef.current = new Map();
      }
      if (!offerBootstrappedRef.current) {
        for (const signal of list) {
          offerLevelsRef.current.set(signal.leadId, offerSignalLevel(signal));
        }
        offerBootstrappedRef.current = true;
        return;
      }
      for (const signal of list) {
        const next = offerSignalLevel(signal);
        const prev = offerLevelsRef.current.get(signal.leadId) ?? 0;
        offerLevelsRef.current.set(signal.leadId, Math.max(prev, next));
        if (next <= prev) continue;
        const adviseurNaam = signal.adviseurNaam || "Adviseur";
        const leadLabel = signal.leadNaam || "";
        if (next >= 3 && prev < 3) {
          const event: OfferEvent = {
            id: `signed-${signal.leadId}-${Date.now()}`,
            kind: "signed",
            adviseurNaam,
            leadLabel,
          };
          if (overviewMode === "live") {
            offerMomentSeenRef.current.add(`signed:${signal.leadId}`);
            enqueueOfferMoment(event);
          } else {
            enqueueSigned(event);
          }
        } else if (next >= 2 && prev < 2) {
          const event: OfferEvent = {
            id: `sent-${signal.leadId}-${Date.now()}`,
            kind: "sent",
            adviseurNaam,
            leadLabel,
          };
          if (overviewMode === "live") {
            offerMomentSeenRef.current.add(`sent:${signal.leadId}`);
            enqueueOfferMoment(event);
          } else {
            pushToast(event);
          }
        } else if (next >= 1 && prev < 1) {
          const event: OfferEvent = {
            id: `created-${signal.leadId}-${Date.now()}`,
            kind: "created",
            adviseurNaam,
            leadLabel,
          };
          if (overviewMode === "live") {
            offerMomentSeenRef.current.add(`created:${signal.leadId}`);
            enqueueOfferMoment(event);
          } else {
            pushToast(event);
          }
        }
      }
    },
    [enqueueOfferMoment, enqueueSigned, overviewMode, pushToast]
  );

  /** Backup: offerte-events uit wall activity (ook zonder afspraak vandaag). */
  const ingestWallOfferActivity = useCallback(
    (wall: WallboardOverview | null | undefined) => {
      if (overviewMode !== "live" || !wall) return;
      const list = wall.activity || [];
      const classify = (
        titel: string
      ): OfferEventKind | null => {
        const t = titel.toLowerCase();
        if (t.includes("getekend") || t.includes("ondertekend")) return "signed";
        if (t.includes("verstuurd")) return "sent";
        if (t.includes("aangemaakt")) return "created";
        return null;
      };
      if (!offerMomentBootstrappedRef.current) {
        for (const ev of list) {
          if (ev.kind !== "offerte") continue;
          const kind = classify(ev.titel);
          if (!kind) continue;
          const leadKey = ev.leadId || ev.id;
          offerMomentSeenRef.current.add(`${kind}:${leadKey}`);
        }
        offerMomentBootstrappedRef.current = true;
        return;
      }
      for (const ev of list) {
        if (ev.kind !== "offerte") continue;
        const kind = classify(ev.titel);
        if (!kind) continue;
        const leadKey = ev.leadId || ev.id;
        const key = `${kind}:${leadKey}`;
        if (offerMomentSeenRef.current.has(key)) continue;
        offerMomentSeenRef.current.add(key);
        enqueueOfferMoment({
          id: `activity-${ev.id}`,
          kind,
          adviseurNaam: ev.actorNaam || "Adviseur",
          leadLabel: ev.leadNaam || "",
        });
      }
    },
    [enqueueOfferMoment, overviewMode]
  );

  /** Live wall: sobere overlay bij nieuwe afboekingen. */
  const ingestWallAfboekActivity = useCallback(
    (wall: WallboardOverview | null | undefined) => {
      if (overviewMode !== "live" || !wall) return;
      const list = wall.activity || [];
      if (!afboekMomentBootstrappedRef.current) {
        for (const ev of list) {
          if (ev.kind !== "afboek") continue;
          afboekMomentSeenRef.current.add(ev.id);
        }
        afboekMomentBootstrappedRef.current = true;
        return;
      }
      // Chronologisch oud→nieuw zodat overlays in volgorde komen.
      const fresh = list
        .filter((ev) => ev.kind === "afboek" && !afboekMomentSeenRef.current.has(ev.id))
        .sort((a, b) => a.at.localeCompare(b.at));
      for (const ev of fresh) {
        afboekMomentSeenRef.current.add(ev.id);
        enqueueAfboekMoment({
          id: `afboek-${ev.id}`,
          adviseurNaam: ev.actorNaam || "Adviseur",
          leadLabel: ev.leadNaam || "",
          uitkomstLabel: afboekUitkomstFromTitel(ev.titel),
        });
      }
    },
    [enqueueAfboekMoment, overviewMode]
  );

  const loadReport = useCallback(
    async (opts?: { silent?: boolean; signal?: AbortSignal }) => {
      const silent = opts?.silent === true;
      if (!silent) {
        setLoading(true);
        setError(null);
      } else {
        setLiveUpdating(true);
      }
      try {
        const res = await fetch(`/api/sales-cockpit?${dataQuery}`, {
          cache: "no-store",
          signal: opts?.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Cockpit laden mislukt");
        const next = json as Report;
        setReport(next);
        if (overviewMode === "dag" || overviewMode === "live") {
          ingestOfferSignals(
            next.dayOverview?.offerSignals,
            `${dayAnchor}:${overviewMode}`
          );
        }
        if (overviewMode === "live") {
          ingestWallOfferActivity(next.wallboard);
          ingestWallAfboekActivity(next.wallboard);
        }
        setError(null);
      } catch (err: unknown) {
        if (opts?.signal?.aborted) return;
        if (!silent) {
          setReport(null);
          setError(
            err instanceof Error ? err.message : "Cockpit laden mislukt"
          );
        }
      } finally {
        if (!opts?.signal?.aborted) {
          if (!silent) setLoading(false);
          setLiveUpdating(false);
        }
      }
    },
    [
      dataQuery,
      dayAnchor,
      ingestOfferSignals,
      ingestWallAfboekActivity,
      ingestWallOfferActivity,
      overviewMode,
    ]
  );

  useEffect(() => {
    if (overviewMode === "live") return;
    offerMomentBootstrappedRef.current = false;
    offerMomentSeenRef.current = new Set();
    offerMomentQueueRef.current = [];
    celebratingOfferMomentRef.current = false;
    if (offerMomentTimerRef.current) clearTimeout(offerMomentTimerRef.current);
    setOfferMoment(null);
    afboekMomentBootstrappedRef.current = false;
    afboekMomentSeenRef.current = new Set();
    afboekMomentQueueRef.current = [];
    celebratingAfboekMomentRef.current = false;
    if (afboekMomentTimerRef.current) clearTimeout(afboekMomentTimerRef.current);
    setAfboekMoment(null);
  }, [overviewMode]);

  useEffect(() => {
    return () => {
      if (offerMomentTimerRef.current) clearTimeout(offerMomentTimerRef.current);
      if (afboekMomentTimerRef.current) clearTimeout(afboekMomentTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void loadReport({ signal: ctrl.signal });
    return () => ctrl.abort();
  }, [loadReport]);

  useEffect(() => {
    if (overviewMode !== "dag" && overviewMode !== "live") return;
    const timer = setInterval(() => {
      void loadReport({ silent: true });
    }, DAY_POLL_MS);
    return () => clearInterval(timer);
  }, [overviewMode, loadReport]);

  useEffect(() => {
    return () => {
      if (signedTimerRef.current) clearTimeout(signedTimerRef.current);
      if (offerMomentTimerRef.current) clearTimeout(offerMomentTimerRef.current);
      for (const timer of toastTimersRef.current.values()) clearTimeout(timer);
      toastTimersRef.current.clear();
      offerMomentGenRef.current += 1;
      const audio = offerMomentAudioRef.current;
      if (audio && offerMomentSoundEndedRef.current) {
        audio.removeEventListener("ended", offerMomentSoundEndedRef.current);
        offerMomentSoundEndedRef.current = null;
      }
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    };
  }, []);

  function setParams(patch: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(sp.toString());
    next.set("tab", "sales_cockpit");
    if (resetPage) next.delete("page");
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === "") next.delete(key);
      else next.set(key, value);
    }
    router.replace(`/?${next.toString()}`, { scroll: false });
  }

  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const next = new URLSearchParams(sp.toString());
      next.set("tab", "sales_cockpit");
      next.delete("fs");
      router.replace(`/?${next.toString()}`, { scroll: false });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, router, sp]);

  function goWeek(direction: -1 | 0 | 1) {
    if (direction === 0) {
      setParams({ week: null });
      return;
    }
    const from = report?.weekOverview.from || weekAnchor;
    setParams({ week: addYmd(from, direction * 7) });
  }

  function goDay(direction: -1 | 0 | 1) {
    if (direction === 0) {
      setParams({ dag: null });
      return;
    }
    const from = report?.dayOverview?.ymd || dayAnchor;
    setParams({ dag: addYmd(from, direction) });
  }

  function setOverviewMode(mode: OverviewMode) {
    setParams(
      {
        overview: mode === "week" ? null : mode,
        // Live wall altijd op vandaag
        ...(mode === "live" ? { dag: null } : {}),
      },
      false
    );
  }

  function toggleFullscreen() {
    setParams({ fs: fullscreen ? null : "1" }, false);
  }

  function toggleTheme() {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }

  const week = report?.weekOverview;
  const day = report?.dayOverview;
  const wallboard = report?.wallboard;
  const salesQuality = report?.salesQuality;
  const weekTrend = report?.weekTrend || [];
  const weekLeaderboard = report?.weekLeaderboard || [];
  const activeTrendGroup =
    report?.trend?.group ||
    trendGroup ||
    defaultGroupBy({
      from: report?.trend?.from || weekAnchor,
      to: report?.trend?.to || weekAnchor,
    });

  function setQualityPeriod(id: QualityPeriodId) {
    if (id === "vrij") {
      const seed = qualityPeriodRange("d30", todayYmd());
      setParams({
        kwaliteit_periode: id,
        kwaliteit_van: isYmd(qualityVanRaw) ? qualityVanRaw : seed.from,
        kwaliteit_tot: isYmd(qualityTotRaw) ? qualityTotRaw : seed.to,
      });
      return;
    }
    setParams({
      kwaliteit_periode: id,
      kwaliteit_van: null,
      kwaliteit_tot: null,
    });
  }

  function setQualityCustomRange(from: string, to: string) {
    let nextFrom = from;
    let nextTo = to;
    if (nextFrom > nextTo) {
      const swap = nextFrom;
      nextFrom = nextTo;
      nextTo = swap;
    }
    setParams({
      kwaliteit_periode: "vrij",
      kwaliteit_van: nextFrom,
      kwaliteit_tot: nextTo,
    });
  }

  function setTrendPeriod(id: TrendPeriodId) {
    if (id === "vrij") {
      const seed = trendPeriodRange("d30", todayYmd());
      setParams({
        trend_periode: id,
        trend_groep: null,
        trend_van: isYmd(trendVanRaw) ? trendVanRaw : seed.from,
        trend_tot: isYmd(trendTotRaw) ? trendTotRaw : seed.to,
      });
      return;
    }
    setParams({
      trend_periode: id,
      trend_groep: null,
      trend_van: null,
      trend_tot: null,
    });
  }

  function setTrendCustomRange(from: string, to: string) {
    let nextFrom = from;
    let nextTo = to;
    if (nextFrom > nextTo) {
      const swap = nextFrom;
      nextFrom = nextTo;
      nextTo = swap;
    }
    setParams({
      trend_periode: "vrij",
      trend_van: nextFrom,
      trend_tot: nextTo,
      trend_groep: null,
    });
  }

  function setTrendGroup(id: GroupBy) {
    setParams({ trend_groep: id });
  }

  function setTrendMetrics(ids: TrendMetricId[]) {
    setParams(
      {
        trend_metrics: ids.join(","),
      },
      false
    );
  }

  function setTrendAdvisorIds(ids: string[]) {
    setParams(
      {
        trend_adv: ids.length > 0 ? ids.join(",") : null,
      },
      false
    );
  }

  const liveFill = overviewMode === "live";

  return (
    <div
      className={cn(
        "sales-cockpit-theme relative w-full bg-[var(--wash)] text-ink",
        liveFill
          ? "flex h-full min-h-0 flex-1 flex-col gap-2 overflow-hidden pb-0"
          : "min-h-full space-y-5 pb-8",
        fullscreen && "min-h-full"
      )}
      data-theme={theme}
    >
      <OfferToasts items={offerToasts} onDismiss={dismissToast} />
      {overviewMode === "live" ? (
        <>
          <audio
            ref={offerMomentAudioRef}
            src={MONEY_SOUNDS[0]}
            preload="auto"
          />
          {MONEY_SOUNDS.slice(1).map((src) => (
            <audio
              key={src}
              src={src}
              preload="auto"
              aria-hidden
              className="hidden"
            />
          ))}
        </>
      ) : null}
      {overviewMode === "live" && offerMoment ? (
        <OfferMomentOverlay
          event={offerMoment}
          onClose={dismissOfferMoment}
        />
      ) : null}
      {overviewMode === "live" && !offerMoment && afboekMoment ? (
        <AfboekMomentOverlay
          event={afboekMoment}
          onClose={dismissAfboekMoment}
        />
      ) : null}
      {overviewMode !== "live" && signedEvent ? (
        <SignedCelebration
          event={signedEvent}
          onClose={() => {
            if (signedTimerRef.current) clearTimeout(signedTimerRef.current);
            playNextSigned();
          }}
        />
      ) : null}

      {!fullscreen ? (
        <header className="flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div className="flex items-start gap-3">
            {onOpenMenu ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="mt-1 md:hidden"
                onClick={onOpenMenu}
                aria-label="Menu"
              >
                <Menu />
              </Button>
            ) : null}
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-green/80">
                Sales
              </p>
              <h1 className="font-display text-[1.85rem] font-semibold leading-none tracking-tight text-green-deeper sm:text-[2.15rem]">
                Cockpit
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Lichtmodus" : "Donkere modus"}
            >
              {theme === "dark" ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
              {theme === "dark" ? "Light" : "Dark"}
            </Button>
          </div>
        </header>
      ) : null}

      {!fullscreen ? (
        <Tabs
          value={VIEWS.some(([id]) => id === view) ? view : "cockpit"}
          onValueChange={(value) => setParams({ view: value }, false)}
          className="shrink-0"
        >
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl border border-line bg-white p-1.5 shadow-sm">
            {VIEWS.map(([id, label]) => (
              <TabsTrigger
                key={id}
                value={id}
                className="rounded-lg px-3.5 py-2 data-[state=active]:bg-green-soft data-[state=active]:text-green-deeper data-[state=active]:shadow-none"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      {error ? (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-5 text-sm text-rose-800">{error}</CardContent>
        </Card>
      ) : null}

      {view === "kwaliteit" ? (
        loading && !salesQuality ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-48 rounded-lg" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-28 rounded-2xl" />
              <Skeleton className="h-28 rounded-2xl" />
              <Skeleton className="h-28 rounded-2xl" />
            </div>
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : (
          <SalesQualitySection
            quality={salesQuality}
            period={qualityPeriod}
            customFrom={qualityCustomFrom}
            customTo={qualityCustomTo}
            onPeriodChange={setQualityPeriod}
            onCustomRangeChange={setQualityCustomRange}
          />
        )
      ) : null}

      {view === "cockpit" || !VIEWS.some(([id]) => id === view) ? (
        <div
          className={cn(
            liveFill
              ? "flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
              : "space-y-10"
          )}
        >
          <section
            className={cn(
              liveFill
                ? "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
                : "space-y-4"
            )}
            aria-labelledby="cockpit-overview-heading"
          >
            <div
              className={cn(
                "flex flex-wrap items-end justify-between gap-3",
                liveFill && "shrink-0"
              )}
            >
              <div>
                {!fullscreen ? (
                  <div
                    className={cn(
                      "inline-flex items-center rounded-xl border border-line bg-white p-0.5 shadow-sm",
                      liveFill ? "mb-0" : "mb-2"
                    )}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 rounded-lg px-3",
                        overviewMode === "week" &&
                          "bg-green-soft text-green-deeper hover:bg-green-soft"
                      )}
                      onClick={() => setOverviewMode("week")}
                    >
                      Week
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 rounded-lg px-3",
                        overviewMode === "dag" &&
                          "bg-green-soft text-green-deeper hover:bg-green-soft"
                      )}
                      onClick={() => setOverviewMode("dag")}
                    >
                      Vandaag
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 rounded-lg px-3",
                        overviewMode === "live" &&
                          "bg-green-soft text-green-deeper hover:bg-green-soft"
                      )}
                      onClick={() => setOverviewMode("live")}
                    >
                      Live
                    </Button>
                  </div>
                ) : null}
                {overviewMode !== "live" ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2
                        id="cockpit-overview-heading"
                        className="font-display text-lg font-semibold text-green-deeper"
                      >
                        {overviewMode === "dag"
                          ? "Dagoverzicht"
                          : "Weekoverzicht"}
                      </h2>
                      {overviewMode === "dag" ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            liveUpdating
                              ? "border-teal-200 bg-teal-50 text-teal-800"
                              : "border-line bg-white text-muted"
                          )}
                          title="Ververst automatisch elke 8 seconden"
                        >
                          <Radio
                            className={cn(
                              "size-3",
                              liveUpdating ? "animate-pulse text-teal-600" : ""
                            )}
                            aria-hidden
                          />
                          Live
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-sm text-muted">
                      {overviewMode === "dag"
                        ? day?.isToday
                          ? "Live overzicht van afspraken, adviseurs en deals vandaag"
                          : "Overzicht van afspraken, adviseurs en deals op de gekozen dag"
                        : week?.isCurrent
                          ? "Belangrijkste cijfers van deze week"
                          : "Belangrijkste cijfers van de gekozen week"}
                    </p>
                  </>
                ) : (
                  <h2 id="cockpit-overview-heading" className="sr-only">
                    Live wall
                  </h2>
                )}
              </div>

              {overviewMode === "live" ? null : overviewMode === "dag" ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="inline-flex items-center rounded-xl border border-line bg-white p-0.5 shadow-sm">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label="Vorige dag"
                      onClick={() => goDay(-1)}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <div className="min-w-[11.5rem] px-2 text-center text-xs font-medium text-ink">
                      <span className="inline-flex items-center justify-center gap-1.5">
                        <CalendarDays className="size-3.5 text-green" />
                        {day ? day.label : "…"}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label="Volgende dag"
                      onClick={() => goDay(1)}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-9",
                      day?.isToday &&
                        "border-green/30 bg-green-soft text-green-deeper"
                    )}
                    onClick={() => goDay(0)}
                    disabled={day?.isToday === true}
                  >
                    Vandaag
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="inline-flex items-center rounded-xl border border-line bg-white p-0.5 shadow-sm">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label="Vorige week"
                      onClick={() => goWeek(-1)}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <div className="min-w-[11.5rem] px-2 text-center text-xs font-medium text-ink">
                      <span className="inline-flex items-center justify-center gap-1.5">
                        <CalendarDays className="size-3.5 text-green" />
                        {week ? week.label : "…"}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label="Volgende week"
                      onClick={() => goWeek(1)}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-9",
                      week?.isCurrent &&
                        "border-green/30 bg-green-soft text-green-deeper"
                    )}
                    onClick={() => goWeek(0)}
                    disabled={week?.isCurrent === true}
                  >
                    Deze week
                  </Button>
                </div>
              )}
            </div>

            {overviewMode === "live" ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <SalesCockpitWall
                  wall={wallboard}
                  liveUpdating={liveUpdating}
                  fullscreen={fullscreen}
                  theme={theme}
                  onToggleFullscreen={toggleFullscreen}
                  onToggleTheme={toggleTheme}
                />
              </div>
            ) : overviewMode === "dag" ? (
              loading && !day ? (
                <div className="grid gap-3 lg:grid-cols-12">
                  <Skeleton className="h-40 w-full rounded-xl lg:col-span-6" />
                  <Skeleton className="h-40 w-full rounded-xl lg:col-span-6" />
                  <Skeleton className="h-56 w-full rounded-xl lg:col-span-12" />
                </div>
              ) : day ? (
                <DayKpiCards day={day} />
              ) : null
            ) : loading && !week ? (
              <div className="grid gap-3 lg:grid-cols-12">
                <Skeleton className="h-56 w-full rounded-xl lg:col-span-7" />
                <Skeleton className="h-56 w-full rounded-xl lg:col-span-5" />
                <Skeleton className="h-48 w-full rounded-xl lg:col-span-6" />
                <Skeleton className="h-48 w-full rounded-xl lg:col-span-6" />
              </div>
            ) : week ? (
              <WeekKpiCards week={week} />
            ) : null}
          </section>

          {overviewMode === "live" ? null : loading && !week ? (
            <section className="space-y-4" aria-hidden>
              <Skeleton className="h-8 w-40 rounded-lg" />
              <Skeleton className="h-80 w-full rounded-xl" />
            </section>
          ) : week ? (
            <WeekTrendSection
              points={weekTrend}
              period={trendPeriod}
              group={activeTrendGroup}
              metrics={trendMetrics}
              rangeLabel={report?.trend?.label}
              customFrom={trendCustomFrom}
              customTo={trendCustomTo}
              advisors={report?.options?.advisors || []}
              selectedAdvisorIds={trendAdvisorIds}
              onPeriodChange={setTrendPeriod}
              onGroupChange={setTrendGroup}
              onMetricsChange={setTrendMetrics}
              onCustomRangeChange={setTrendCustomRange}
              onAdvisorIdsChange={setTrendAdvisorIds}
            />
          ) : null}

          {overviewMode === "live" ? null : loading && !week ? (
            <section className="space-y-4" aria-hidden>
              <Skeleton className="h-8 w-48 rounded-lg" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </section>
          ) : week ? (
            <WeekLeaderboardSection
              rows={weekLeaderboard}
              weekLabel={week.label}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

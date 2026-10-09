"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatEuro } from "@/lib/format";
import {
  DASHBOARD_V2_PERIOD_LABELS,
  type DashboardV2AdviseurBar,
  type DashboardV2Capacity,
  type DashboardV2Data,
  type DashboardV2Forecast,
  type DashboardV2Kpi,
  type DashboardV2Period,
  type DashboardV2Scope,
  type ForecastWeek,
} from "@/lib/dashboard-v2";
import { NETTO_COMMISSIE_PCT } from "@/lib/netto-boord";
import {
  agendaWeekJumpOptions,
  formatSchouwWeekLabel,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekValue,
} from "@/lib/schouw-week";
import { KpiDetailOverlay } from "./DashboardV2KpiDetail";

const PERIODS: DashboardV2Period[] = [
  "last_7_days",
  "calendar_week",
  "this_month",
  "last_14_days",
  "last_28_days",
  "last_6_months",
  "all",
  "custom",
];

function currentWeekKey(): string {
  const { jaar, week } = schouwWeekFromDate(new Date());
  return schouwWeekValue(jaar, week);
}

function qsPeriod(
  period: DashboardV2Period,
  fromDate: string,
  toDate: string,
  weekKey: string,
  scope: DashboardV2Scope,
  personId: string
): string {
  const p = new URLSearchParams({ period, scope });
  if (period === "custom" && fromDate && toDate) {
    p.set("from", fromDate);
    p.set("to", toDate);
  }
  if (period === "calendar_week" && weekKey) {
    p.set("week", weekKey);
  }
  if (scope !== "team" && personId) p.set("person", personId);
  return p.toString();
}
const GOAL = "#1a8a3e";
const NOW = "#f37021";
const TRACK = "#E8E6E1";

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

function restLabel(actual: number, goal: number, fmt: (n: number) => string) {
  if (!goal) return null;
  const diff = goal - actual;
  if (diff <= 0) return `Doel behaald (+${fmt(Math.abs(diff))})`;
  return `Nog ${fmt(diff)} tot doel`;
}

function clampPct(actual: number, goal: number): number {
  if (!goal) return 0;
  return Math.min(100, Math.max(0, (actual / goal) * 100));
}

/** Donut: voortgang t.o.v. volume-doel (leads, orders, afspraken, omzet). */
function ProgressDonut({
  title,
  actual,
  goal,
  formatValue,
  onOpen,
}: {
  title: string;
  actual: number;
  goal: number;
  formatValue: (n: number) => string;
  onOpen: () => void;
}) {
  const pct = clampPct(actual, goal);
  const onTrack = goal > 0 && actual >= goal;
  const rest = restLabel(actual, goal, formatValue);
  const size = 132;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full w-full flex-col rounded-2xl border border-line bg-white p-5 text-left transition hover:border-green hover:shadow-[0_8px_24px_rgba(26,138,62,0.08)]"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-display text-base font-semibold text-ink">{title}</p>
        <span className="text-[11px] font-semibold text-green-dark">Open →</span>
      </div>

      <div className="mt-3 flex flex-1 flex-col items-center justify-center">
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={TRACK}
              strokeWidth={stroke}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={onTrack ? GOAL : NOW}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c - dash}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="font-display text-2xl font-semibold tabular-nums text-ink">
              {formatValue(actual)}
            </p>
            <p className="text-[11px] text-muted">
              van {formatValue(goal)}
            </p>
          </div>
        </div>
        <p
          className={[
            "mt-3 text-sm font-semibold tabular-nums",
            onTrack ? "text-[#1a8a3e]" : "text-ink",
          ].join(" ")}
        >
          {Math.round(pct)}% van doel
        </p>
        {rest ? (
          <p className="mt-0.5 text-center text-[12px] text-muted">{rest}</p>
        ) : null}
      </div>
    </button>
  );
}

/** Lijn/area-verloop met horizontale doellijn + hover-tooltip. */
function TrendLine({
  title,
  subtitle,
  labels,
  actual,
  goalTotal,
  formatValue,
  rateGoal,
  /** Periode-KPI (bij ratio: echte periode-conversie; bij volume: optioneel override) */
  periodValue,
  onOpen,
}: {
  title: string;
  subtitle?: string;
  labels: string[];
  actual: number[];
  goalTotal: number;
  formatValue: (n: number) => string;
  rateGoal?: boolean;
  periodValue?: number | null;
  onOpen: () => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = Math.max(labels.length, 1);
  const goalEach = rateGoal
    ? goalTotal
    : Math.round((goalTotal / n) * 100) / 100;
  const bucketAvg =
    actual.length > 0
      ? Math.round(
          (actual.reduce((s, v) => s + v, 0) / actual.length) * 10
        ) / 10
      : 0;
  const periodAvg =
    periodValue != null && Number.isFinite(periodValue)
      ? periodValue
      : bucketAvg;
  const max = Math.max(...actual, goalEach, 1);
  const w = 320;
  const h = 120;
  const padX = 8;
  const padY = 12;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;

  const points = actual.map((v, i) => {
    const x = padX + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = padY + innerH - (v / max) * innerH;
    return { x, y, v, label: labels[i] || "" };
  });

  const lineD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const areaD =
    points.length > 0
      ? `${lineD} L ${points[points.length - 1]!.x.toFixed(1)} ${(padY + innerH).toFixed(1)} L ${points[0]!.x.toFixed(1)} ${(padY + innerH).toFixed(1)} Z`
      : "";
  const goalY = padY + innerH - (goalEach / max) * innerH;
  const last = actual[actual.length - 1] ?? 0;
  const hover = hoverIdx != null ? points[hoverIdx] : null;

  const vsGoalDiff = rateGoal
    ? periodAvg - goalTotal
    : periodAvg - goalEach;
  const vsGoalOnTrack = rateGoal
    ? goalTotal > 0 && periodAvg >= goalTotal
    : goalEach > 0 && periodAvg >= goalEach;
  function nearestIndex(clientX: number, rect: DOMRect): number {
    if (points.length === 0) return 0;
    const svgX = ((clientX - rect.left) / Math.max(rect.width, 1)) * w;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i]!.x - svgX);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full w-full flex-col rounded-2xl border border-line bg-white p-5 text-left transition hover:border-green hover:shadow-[0_8px_24px_rgba(26,138,62,0.08)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-base font-semibold text-ink">{title}</p>
          <p className="mt-0.5 text-sm text-muted">
            {subtitle || "Verloop"} · gem.{" "}
            <span className="font-semibold tabular-nums text-ink">
              {formatValue(periodAvg)}
            </span>
            {goalTotal > 0 ? (
              <span
                className={[
                  "ml-1.5 text-[12px] font-semibold tabular-nums",
                  vsGoalOnTrack ? "text-[#1a8a3e]" : "text-[#C45A12]",
                ].join(" ")}
              >
                {vsGoalOnTrack ? "+" : "−"}
                {rateGoal
                  ? `${Math.abs(vsGoalDiff).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%-pt`
                  : formatValue(Math.abs(vsGoalDiff))}
              </span>
            ) : null}
            <span className="ml-1.5 text-[11px] text-muted">
              · laatste {formatValue(last)}
            </span>
          </p>
        </div>
        <span className="text-[11px] font-semibold text-green-dark">Open →</span>
      </div>

      <div className="mt-4 w-full">
        <div
          className="relative"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setHoverIdx(nearestIndex(e.clientX, rect));
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {hover ? (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-white px-2.5 py-1.5 shadow-md"
              style={{
                left: `${(hover.x / w) * 100}%`,
                top: `${Math.max(8, (hover.y / h) * 100 - 4)}%`,
              }}
            >
              <p className="whitespace-nowrap text-[11px] font-medium capitalize text-muted">
                {hover.label}
              </p>
              <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-ink">
                {formatValue(hover.v)}
                <span className="ml-1 text-[11px] font-medium text-muted">
                  / {formatValue(goalEach)}
                </span>
              </p>
              {(() => {
                const diff = hover.v - goalEach;
                const onTrack = goalEach > 0 && hover.v >= goalEach;
                const abs = Math.abs(diff);
                const diffLabel = rateGoal
                  ? `${abs.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%-punt`
                  : formatValue(abs);
                if (!goalEach) return null;
                return (
                  <p
                    className={[
                      "mt-0.5 whitespace-nowrap text-[11px] font-semibold tabular-nums",
                      onTrack ? "text-[#1a8a3e]" : "text-[#C45A12]",
                    ].join(" ")}
                  >
                    {onTrack
                      ? `+${diffLabel} t.o.v. doel`
                      : `−${diffLabel} tot doel`}
                  </p>
                );
              })()}
            </div>
          ) : null}

          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="h-[7.5rem] w-full"
            preserveAspectRatio="none"
          >
            <line
              x1={padX}
              y1={goalY}
              x2={w - padX}
              y2={goalY}
              stroke={GOAL}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              opacity={0.85}
            />
            {areaD ? (
              <path d={areaD} fill={NOW} fillOpacity={0.12} />
            ) : null}
            {lineD ? (
              <path
                d={lineD}
                fill="none"
                stroke={NOW}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {hover ? (
              <line
                x1={hover.x}
                y1={padY}
                x2={hover.x}
                y2={padY + innerH}
                stroke="#9CA3AF"
                strokeWidth={1}
                strokeDasharray="3 2"
              />
            ) : null}
            {points.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={hoverIdx === i ? 5 : 3}
                fill={NOW}
                stroke={hoverIdx === i ? "#fff" : "none"}
                strokeWidth={hoverIdx === i ? 2 : 0}
              />
            ))}
          </svg>
        </div>
        <div className="mt-1 flex justify-between gap-1 text-[10px] text-muted">
          <span className="truncate">{labels[0]}</span>
          {labels.length > 2 ? (
            <span className="truncate text-center">
              {labels[Math.floor(labels.length / 2)]}
            </span>
          ) : null}
          <span className="truncate text-right">
            {labels[labels.length - 1]}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Stippellijn ={" "}
          {rateGoal ? "doel%" : `doel per bucket (${formatValue(goalEach)})`}
          {" · hover voor detail"}
        </p>
      </div>
    </button>
  );
}

/** Horizontale voortgangsbalken per sales — ranking. */
function SalesRace({
  rows,
  onOpen,
}: {
  rows: { id: string; naam: string; omzet: number; omzetGoal: number }[];
  onOpen: () => void;
}) {
  const max = Math.max(
    ...rows.map((r) => r.omzet),
    ...rows.map((r) => r.omzetGoal),
    1
  );
  const sorted = [...rows].sort((a, b) => b.omzet - a.omzet);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full w-full flex-col rounded-2xl border border-line bg-white p-5 text-left transition hover:border-green hover:shadow-[0_8px_24px_rgba(26,138,62,0.08)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-base font-semibold text-ink">
            Omzet per sales
          </p>
          <p className="mt-0.5 text-sm text-muted">
            Oranje = omzet · groenstreep = doel
          </p>
        </div>
        <span className="text-[11px] font-semibold text-green-dark">Open →</span>
      </div>

      {sorted.length === 0 ? (
        <p className="mt-8 text-sm text-muted">Geen salesmedewerkers.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {sorted.map((r) => {
            const wNow = (r.omzet / max) * 100;
            const wGoal = (r.omzetGoal / max) * 100;
            const hit = r.omzetGoal > 0 && r.omzet >= r.omzetGoal;
            return (
              <li key={r.id}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {r.naam}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                    {money(r.omzet)}
                  </span>
                </div>
                <div className="relative h-2.5 overflow-hidden rounded-full bg-[#E8E6E1]">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${wNow}%`,
                      background: hit ? GOAL : NOW,
                    }}
                  />
                  {r.omzetGoal > 0 ? (
                    <div
                      className="absolute top-0 bottom-0 w-0.5"
                      style={{
                        left: `${Math.min(wGoal, 100)}%`,
                        background: GOAL,
                      }}
                      title={`Doel ${money(r.omzetGoal)}`}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </button>
  );
}

type ForecastSeries = {
  key: string;
  label: string;
  color: string;
  forecastColor: string;
  get: (m: ForecastWeek["metrics"]) => number;
  format: (n: number) => string;
};

/** Gegroepeerde staven: per week meerdere KPI's naast elkaar. */
function ForecastGroupedBars({
  title,
  subtitle,
  weeks,
  series,
}: {
  title: string;
  subtitle?: string;
  weeks: ForecastWeek[];
  series: ForecastSeries[];
}) {
  const [hover, setHover] = useState<{
    weekIdx: number;
    seriesIdx: number;
  } | null>(null);

  const max = Math.max(
    1,
    ...weeks.flatMap((w) => series.map((s) => s.get(w.metrics)))
  );

  const groupCount = weeks.length;
  const barCount = series.length;
  const w = 420;
  const h = 160;
  const padL = 8;
  const padR = 8;
  const padT = 16;
  const padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const groupW = innerW / Math.max(groupCount, 1);
  const gap = 2;
  const barW = Math.max(
    4,
    (groupW - 10 - gap * (barCount - 1)) / Math.max(barCount, 1)
  );

  const tip =
    hover != null
      ? (() => {
          const week = weeks[hover.weekIdx];
          const s = series[hover.seriesIdx];
          if (!week || !s) return null;
          return {
            label: week.label,
            series: s.label,
            value: s.format(s.get(week.metrics)),
            kind: week.kind,
          };
        })()
      : null;

  return (
    <div className="flex h-full w-full flex-col rounded-2xl border border-line bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-base font-semibold text-ink">{title}</p>
          {subtitle ? (
            <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
          ) : null}
        </div>
      </div>

      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-40 w-full"
          preserveAspectRatio="none"
          onMouseLeave={() => setHover(null)}
        >
          {weeks.map((week, wi) => {
            const gx = padL + wi * groupW + 5;
            return (
              <g key={week.key}>
                {series.map((s, si) => {
                  const v = s.get(week.metrics);
                  const bh = (v / max) * innerH;
                  const x = gx + si * (barW + gap);
                  const y = padT + innerH - bh;
                  const isFc = week.kind === "forecast";
                  return (
                    <rect
                      key={s.key}
                      x={x}
                      y={y}
                      width={barW}
                      height={Math.max(bh, v > 0 ? 1.5 : 0)}
                      rx={2}
                      fill={isFc ? s.forecastColor : s.color}
                      opacity={isFc ? 0.75 : 1}
                      stroke={isFc ? s.color : "none"}
                      strokeWidth={isFc ? 1 : 0}
                      strokeDasharray={isFc ? "3 2" : undefined}
                      className="cursor-pointer"
                      onMouseEnter={() =>
                        setHover({ weekIdx: wi, seriesIdx: si })
                      }
                    />
                  );
                })}
                <text
                  x={gx + (barCount * (barW + gap) - gap) / 2}
                  y={h - 8}
                  textAnchor="middle"
                  className="fill-current"
                  style={{
                    fontSize: 9,
                    fill: week.kind === "forecast" ? "#1a8a3e" : "#6b7280",
                    fontWeight: week.kind === "forecast" ? 600 : 400,
                  }}
                >
                  {week.shortLabel}
                </text>
              </g>
            );
          })}
          {/* Scheiding actual / forecast */}
          {(() => {
            const firstFc = weeks.findIndex((w) => w.kind === "forecast");
            if (firstFc <= 0) return null;
            const x = padL + firstFc * groupW;
            return (
              <line
                x1={x}
                x2={x}
                y1={padT}
                y2={padT + innerH}
                stroke="#D4D0C8"
                strokeDasharray="4 3"
              />
            );
          })()}
        </svg>

        {tip ? (
          <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-lg border border-line bg-white px-3 py-1.5 text-xs shadow-md">
            <p className="font-semibold text-ink">{tip.series}</p>
            <p className="tabular-nums text-ink">{tip.value}</p>
            <p className="text-muted">
              {tip.label}
              {tip.kind === "forecast" ? " · forecast" : ""}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: s.color }}
            />
            {s.label}
          </span>
        ))}
        <span className="text-muted">· gestippeld = forecast</span>
      </div>
    </div>
  );
}

function CapacitySection({ capacity }: { capacity: DashboardV2Capacity }) {
  const l2aPct = Math.round(capacity.targetLeadToAppt * 100);
  const [showAdviseurs, setShowAdviseurs] = useState(false);
  const sorted = [...capacity.adviseurs].sort(
    (a, b) => b.leadsNodig - a.leadsNodig || a.naam.localeCompare(b.naam, "nl")
  );

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Leads nodig · agenda-capaciteit
          </h3>
          <p className="mt-1 text-sm text-muted">
            Komende {capacity.weeksAhead} weken · {capacity.adviseurCount}{" "}
            planbare adviseurs · doel {l2aPct}% lead→afspraak. Afgeblokte
            tijden en week-uit tellen niet mee.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdviseurs((v) => !v)}
          className="text-xs font-semibold text-green hover:underline"
        >
          {showAdviseurs ? "Verberg per adviseur" : "Per adviseur"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-line bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Vrije slots
          </p>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-ink">
            {num(capacity.slotsVrij)}
          </p>
          <p className="mt-1 text-xs text-muted">
            van {num(capacity.slotsOpen)} open · {num(capacity.slotsGepland)}{" "}
            gepland
          </p>
        </div>
        <div className="rounded-2xl border border-green/30 bg-green-soft/40 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Leads nodig
          </p>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-green-deeper">
            {num(capacity.leadsNodig)}
          </p>
          <p className="mt-1 text-xs text-muted">
            ≈ {num(capacity.leadsNodigPerWeek, 1)}/week bij {l2aPct}% L2A
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Afgeblokt
          </p>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-ink">
            {num(capacity.slotsAfgeblokt)}
          </p>
          <p className="mt-1 text-xs text-muted">
            slots (incl. ma 10:00 weekmeeting)
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Gepland
          </p>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-ink">
            {num(capacity.slotsGepland)}
          </p>
          <p className="mt-1 text-xs text-muted">
            huisbezoeken in het venster
          </p>
        </div>
      </div>

      {capacity.weeks.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-semibold">Week</th>
                <th className="px-3 py-2 font-semibold tabular-nums">Open</th>
                <th className="px-3 py-2 font-semibold tabular-nums">
                  Afgeblokt
                </th>
                <th className="px-3 py-2 font-semibold tabular-nums">
                  Gepland
                </th>
                <th className="px-3 py-2 font-semibold tabular-nums">Vrij</th>
                <th className="px-3 py-2 font-semibold tabular-nums">
                  Leads nodig
                </th>
              </tr>
            </thead>
            <tbody>
              {capacity.weeks.map((w) => (
                <tr
                  key={`${w.jaar}-W${w.week}`}
                  className="border-b border-line/70 last:border-0"
                >
                  <td className="px-3 py-2 font-medium text-ink">{w.label}</td>
                  <td className="px-3 py-2 tabular-nums text-muted">
                    {num(w.slotsOpen)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted">
                    {num(w.slotsAfgeblokt)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted">
                    {num(w.slotsGepland)}
                  </td>
                  <td className="px-3 py-2 tabular-nums font-semibold text-ink">
                    {num(w.slotsVrij)}
                  </td>
                  <td className="px-3 py-2 tabular-nums font-semibold text-green-deeper">
                    {num(w.leadsNodig)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showAdviseurs && sorted.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-semibold">Adviseur</th>
                <th className="px-3 py-2 font-semibold tabular-nums">Open</th>
                <th className="px-3 py-2 font-semibold tabular-nums">
                  Afgeblokt
                </th>
                <th className="px-3 py-2 font-semibold tabular-nums">
                  Gepland
                </th>
                <th className="px-3 py-2 font-semibold tabular-nums">Vrij</th>
                <th className="px-3 py-2 font-semibold tabular-nums">
                  Leads nodig
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-line/70 last:border-0"
                >
                  <td className="px-3 py-2 font-medium text-ink">{a.naam}</td>
                  <td className="px-3 py-2 tabular-nums text-muted">
                    {num(a.slotsOpen)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted">
                    {num(a.slotsAfgeblokt)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted">
                    {num(a.slotsGepland)}
                  </td>
                  <td className="px-3 py-2 tabular-nums font-semibold text-ink">
                    {num(a.slotsVrij)}
                  </td>
                  <td className="px-3 py-2 tabular-nums font-semibold text-green-deeper">
                    {num(a.leadsNodig)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function ForecastSection({ forecast }: { forecast: DashboardV2Forecast }) {
  const weeks = forecast.weeks;
  const b = forecast.baseline;

  return (
    <section className="mt-8">
      <div className="mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Forecast KPI&apos;s
        </h3>
        <p className="mt-1 text-sm text-muted">
          Laatste {forecast.historyCount} volledige weken +{" "}
          {forecast.forecastCount} weken vooruit. Elke forecast-week = gemiddelde
          van de 3 weken ervoor (ook forecast-op-forecast). Basis gem.:{" "}
          <span className="tabular-nums text-ink">
            {num(b.orders, 1)} orders · {money(b.omzet)} · L2A{" "}
            {num(b.leadToAppt, 1)}% · A→S {num(b.afspraakToSale, 1)}%
          </span>
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ForecastGroupedBars
          title="Volumes"
          subtitle="Leads, afspraken en sales naast elkaar per week"
          weeks={weeks}
          series={[
            {
              key: "leads",
              label: "Leads",
              color: "#64748b",
              forecastColor: "#E8E6E1",
              get: (m) => m.leads,
              format: (n) => num(n, 1),
            },
            {
              key: "afspraken",
              label: "Afspraken",
              color: "#0d9488",
              forecastColor: "#ccfbf1",
              get: (m) => m.afsprakenGepland,
              format: (n) => num(n, 1),
            },
            {
              key: "orders",
              label: "Sales",
              color: NOW,
              forecastColor: "#ffe4d4",
              get: (m) => m.orders,
              format: (n) => num(n, 1),
            },
          ]}
        />
        <ForecastGroupedBars
          title="Omzet"
          subtitle="Verwachte weekomzet bij huidige tempo"
          weeks={weeks}
          series={[
            {
              key: "omzet",
              label: "Omzet",
              color: NOW,
              forecastColor: "#ffe4d4",
              get: (m) => m.omzet,
              format: money,
            },
          ]}
        />
        <ForecastGroupedBars
          title="Conversie"
          subtitle="Lead → afspraak en Afspraak → sale %"
          weeks={weeks}
          series={[
            {
              key: "l2a",
              label: "Lead → afspraak",
              color: "#2563eb",
              forecastColor: "#dbeafe",
              get: (m) => m.leadToAppt,
              format: (n) => `${num(n, 1)}%`,
            },
            {
              key: "a2s",
              label: "Afspraak → sale",
              color: GOAL,
              forecastColor: "#dcfce7",
              get: (m) => m.afspraakToSale,
              format: (n) => `${num(n, 1)}%`,
            },
          ]}
        />
      </div>
    </section>
  );
}

export function DashboardV2() {
  const [period, setPeriod] = useState<DashboardV2Period>("last_14_days");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [weekKey, setWeekKey] = useState(currentWeekKey);
  const [scope, setScope] = useState<DashboardV2Scope>("team");
  const [personId, setPersonId] = useState("");
  const [data, setData] = useState<DashboardV2Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openKpi, setOpenKpi] = useState<DashboardV2Kpi | null>(null);

  const weekOptions = useMemo(() => {
    const base = agendaWeekJumpOptions(26, 4);
    if (weekKey && !base.some((o) => o.value === weekKey)) {
      const parsed = parseSchouwWeekValue(weekKey);
      if (parsed) {
        return [
          {
            value: weekKey,
            label: formatSchouwWeekLabel(parsed.jaar, parsed.week),
            jaar: parsed.jaar,
            week: parsed.week,
          },
          ...base,
        ];
      }
    }
    return base;
  }, [weekKey]);

  const load = useCallback(async () => {
    if (period === "custom" && (!fromDate || !toDate)) {
      setLoading(false);
      return;
    }
    if (period === "calendar_week" && !weekKey) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard-v2?${qsPeriod(period, fromDate, toDate, weekKey, scope, personId)}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      const dash = json.dashboard as DashboardV2Data;
      setData(dash);
      if (dash.personId && dash.personId !== personId) {
        setPersonId(dash.personId);
      }
      if (dash.weekKey && dash.weekKey !== weekKey) {
        setWeekKey(dash.weekKey);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [period, fromDate, toDate, weekKey, scope, personId]);

  useEffect(() => {
    if (period === "custom") {
      if (!fromDate || !toDate) return;
      void load();
      return;
    }
    if (period === "calendar_week" && !weekKey) return;
    void load();
  }, [period, fromDate, toDate, weekKey, scope, personId, load]);

  // Bij switch naar custom: seed datums vanuit laatste geladen range
  useEffect(() => {
    if (period === "custom" && data && (!fromDate || !toDate)) {
      setFromDate(data.fromDate);
      setToDate(data.toDate);
    }
  }, [period, data, fromDate, toDate]);

  const labels = data?.buckets.map((b) => b.label) || [];
  const g = data?.goals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted">
          <span>Donut = voortgang t.o.v. doel · lijn = verloop</span>
          <span className="text-muted">· klik een KPI voor rapportage</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/?tab=admin"
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-wash"
          >
            Doelen → Admin
          </Link>
          <label className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Weergave
            </span>
            <select
              value={scope}
              onChange={(e) => {
                const next = e.target.value as DashboardV2Scope;
                setScope(next);
                if (next === "team") setPersonId("");
              }}
              className="bg-transparent text-sm font-semibold text-ink outline-none"
            >
              <option value="team">Team</option>
              <option value="adviseur">Adviseur</option>
              <option value="beller">Beller</option>
            </select>
          </label>
          {scope !== "team" ? (
            <label className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Persoon
              </span>
              <select
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                className="max-w-[12rem] bg-transparent text-sm font-semibold text-ink outline-none"
              >
                {(data?.people || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.naam}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Periode
            </span>
            <select
              value={period}
              onChange={(e) => {
                const next = e.target.value as DashboardV2Period;
                setPeriod(next);
                if (next === "calendar_week" && !weekKey) {
                  setWeekKey(currentWeekKey());
                }
              }}
              className="bg-transparent text-sm font-semibold text-ink outline-none"
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {DASHBOARD_V2_PERIOD_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          {period === "calendar_week" ? (
            <label className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Week
              </span>
              <select
                value={weekKey}
                onChange={(e) => setWeekKey(e.target.value)}
                className="max-w-[16rem] bg-transparent text-sm font-semibold text-ink outline-none"
              >
                {weekOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {period === "custom" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-3 py-2">
              <label className="flex items-center gap-1.5 text-sm">
                <span className="text-[11px] font-semibold uppercase text-muted">
                  Van
                </span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="rounded-md border border-line bg-wash px-2 py-1 text-sm font-semibold text-ink outline-none"
                />
                <span className="text-[11px] text-muted">00:00</span>
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <span className="text-[11px] font-semibold uppercase text-muted">
                  Tot
                </span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="rounded-md border border-line bg-wash px-2 py-1 text-sm font-semibold text-ink outline-none"
                />
                <span className="text-[11px] text-muted">23:59</span>
              </label>
            </div>
          ) : data ? (
            <p className="text-[12px] text-muted">
              {data.fromDate} 00:00 → {data.toDate} 23:59
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-[#C62828]/30 bg-[#FFEBEE] px-3 py-2 text-sm text-[#C62828]">
          {error}
        </p>
      ) : null}

      {period === "custom" && (!fromDate || !toDate) ? (
        <p className="text-sm text-muted">
          Kies een begindatum en einddatum (beide 00:00 Amsterdam; einddag
          telt volledig mee tot 23:59).
        </p>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-muted">Laden…</p>
      ) : data && g ? (
        <>
          <section>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Stand vs doel · {data.periodLabel.toLowerCase()}
              {data.personNaam ? ` · ${data.personNaam}` : " · team"}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3">
              <ProgressDonut
                title="Leads"
                actual={data.totals.leads}
                goal={g.leads}
                formatValue={(n) => num(n)}
                onOpen={() => setOpenKpi("leads")}
              />
              <ProgressDonut
                title="Orders"
                actual={data.totals.orders}
                goal={g.orders}
                formatValue={(n) => num(n)}
                onOpen={() => setOpenKpi("orders")}
              />
              <ProgressDonut
                title="Lead → afspraak"
                actual={data.totals.leadToAppt ?? 0}
                goal={g.leadToAppt}
                formatValue={(n) => `${num(n, 1)}%`}
                onOpen={() => setOpenKpi("leadToAppt")}
              />
              <ProgressDonut
                title="Afspraak → sale"
                actual={data.totals.afspraakToSale ?? 0}
                goal={g.afspraakToSale}
                formatValue={(n) => `${num(n, 1)}%`}
                onOpen={() => setOpenKpi("afspraakToSale")}
              />
              <ProgressDonut
                title="Afspraken gepland"
                actual={data.totals.afsprakenGepland}
                goal={g.afsprakenGepland}
                formatValue={(n) => num(n)}
                onOpen={() => setOpenKpi("afsprakenGepland")}
              />
              <ProgressDonut
                title="Omzet"
                actual={data.totals.omzet}
                goal={g.omzet}
                formatValue={money}
                onOpen={() => setOpenKpi("omzet")}
              />
              <button
                type="button"
                onClick={() => setOpenKpi("annuleringen")}
                className="flex h-full w-full flex-col rounded-2xl border border-line bg-white p-5 text-left transition hover:border-green hover:shadow-[0_8px_24px_rgba(26,138,62,0.08)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display text-base font-semibold text-ink">
                    Annuleringen
                  </p>
                  <span className="text-[11px] font-semibold text-green-dark">
                    Open →
                  </span>
                </div>
                <div className="mt-4 flex flex-1 flex-col justify-center">
                  <p className="font-display text-3xl font-semibold tabular-nums text-ink">
                    {data.totals.annuleringsPct != null
                      ? `${num(data.totals.annuleringsPct, 1)}%`
                      : "—"}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {num(data.totals.annuleringen)} geannuleerd van{" "}
                    {num(
                      data.totals.orders + data.totals.annuleringen
                    )}{" "}
                    getekend
                  </p>
                  <p className="mt-1 text-sm font-medium tabular-nums text-[#C62828]">
                    Verloren omzet {money(data.totals.verlorenOmzet)}
                  </p>
                  {data.deltas.annuleringsPct != null ? (
                    <p
                      className={[
                        "mt-2 text-xs font-semibold tabular-nums",
                        data.deltas.annuleringsPct > 0
                          ? "text-[#C62828]"
                          : data.deltas.annuleringsPct < 0
                            ? "text-[#1a8a3e]"
                            : "text-muted",
                      ].join(" ")}
                    >
                      {data.deltas.annuleringsPct > 0 ? "+" : ""}
                      {num(data.deltas.annuleringsPct, 1)} pp vs vorige periode
                    </p>
                  ) : null}
                </div>
              </button>
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Verloop binnen periode
              {data.granularity === "week"
                ? " (per week)"
                : data.granularity === "month"
                  ? " (per maand)"
                  : " (per dag)"}
            </h3>
            <div className="grid gap-4 lg:grid-cols-2">
              <TrendLine
                title="Leads"
                labels={labels}
                actual={data.buckets.map((b) => b.leads)}
                goalTotal={g.leads}
                formatValue={(n) => num(n)}
                onOpen={() => setOpenKpi("leads")}
              />
              <TrendLine
                title="Orders"
                labels={labels}
                actual={data.buckets.map((b) => b.orders)}
                goalTotal={g.orders}
                formatValue={(n) => num(n)}
                onOpen={() => setOpenKpi("orders")}
              />
              <TrendLine
                title="Afspraken gepland"
                labels={labels}
                actual={data.buckets.map((b) => b.afsprakenGepland)}
                goalTotal={g.afsprakenGepland}
                formatValue={(n) => num(n)}
                onOpen={() => setOpenKpi("afsprakenGepland")}
              />
              <TrendLine
                title="Lead → afspraak"
                subtitle="Conversie%"
                labels={labels}
                actual={data.buckets.map((b) => b.leadToAppt ?? 0)}
                goalTotal={g.leadToAppt}
                formatValue={(n) => `${num(n, 1)}%`}
                rateGoal
                periodValue={data.totals.leadToAppt}
                onOpen={() => setOpenKpi("leadToAppt")}
              />
              <TrendLine
                title="Afspraak → sale"
                subtitle="Afgeboekte afspraken → order"
                labels={labels}
                actual={data.buckets.map((b) => b.afspraakToSale ?? 0)}
                goalTotal={g.afspraakToSale}
                formatValue={(n) => `${num(n, 1)}%`}
                rateGoal
                periodValue={data.totals.afspraakToSale}
                onOpen={() => setOpenKpi("afspraakToSale")}
              />
              <TrendLine
                title="Omzet"
                labels={labels}
                actual={data.buckets.map((b) => b.omzet)}
                goalTotal={g.omzet}
                formatValue={money}
                onOpen={() => setOpenKpi("omzet")}
              />
              <TrendLine
                title="Annuleringen %"
                subtitle="Geannuleerd van getekende orders"
                labels={labels}
                actual={data.buckets.map((b) => b.annuleringsPct ?? 0)}
                goalTotal={0}
                formatValue={(n) => `${num(n, 1)}%`}
                rateGoal
                periodValue={data.totals.annuleringsPct}
                onOpen={() => setOpenKpi("annuleringen")}
              />
              <TrendLine
                title="Verloren omzet"
                subtitle="Omzet excl. btw van geannuleerde orders"
                labels={labels}
                actual={data.buckets.map((b) => b.verlorenOmzet)}
                goalTotal={0}
                formatValue={money}
                periodValue={data.totals.verlorenOmzet}
                onOpen={() => setOpenKpi("annuleringen")}
              />
              <SalesRace
                rows={data.adviseurs.map((a) => ({
                  id: a.id,
                  naam: a.naam,
                  omzet: a.omzet,
                  omzetGoal: a.omzetGoal || 0,
                }))}
                onOpen={() => setOpenKpi("sales")}
              />
            </div>
          </section>

          {data.capacity ? (
            <CapacitySection capacity={data.capacity} />
          ) : null}

          {data.forecast ? <ForecastSection forecast={data.forecast} /> : null}
        </>
      ) : null}

      {openKpi ? (
        <KpiDetailOverlay
          kpi={openKpi}
          period={period}
          fromDate={fromDate || data?.fromDate || ""}
          toDate={toDate || data?.toDate || ""}
          weekKey={weekKey || data?.weekKey || ""}
          onClose={() => setOpenKpi(null)}
        />
      ) : null}
    </div>
  );
}

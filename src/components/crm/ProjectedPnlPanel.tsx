"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { AMSTERDAM_TZ, formatEuro } from "@/lib/format";
import type {
  PnlMetrics,
  PnlMonthBucket,
  PnlWeekBucket,
} from "@/lib/projected-pnl";
import {
  agendaWeekJumpOptions,
  formatSchouwWeekLabel,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import {
  conversieMonthRangeContaining,
  todayConversieYmd,
} from "@/lib/conversie-period";
import { addDays, addMonths, addWeeks } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

type PnlData = {
  startYmd: string;
  endYmd: string;
  periodLabel: string;
  totals: PnlMetrics;
  series: PnlWeekBucket[];
  months: PnlMonthBucket[];
};

type RangeMode = "weeks" | "month";

export type ProjectedPnlRangeProps = {
  rangeMode?: RangeMode;
  rangeWeekKey?: string;
  rangeMonthYm?: string;
  hideRangeControls?: boolean;
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

function pctChange(
  curr: number | null | undefined,
  prev: number | null | undefined
): number | null {
  if (curr == null || prev == null || Number.isNaN(curr) || Number.isNaN(prev)) {
    return null;
  }
  if (prev === 0) return curr === 0 ? 0 : 100;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function fmtPctDelta(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("nl-NL", {
    maximumFractionDigits: 0,
  })}%`;
}

function deltaTone(n: number | null): string {
  if (n == null || n === 0) return "text-muted";
  return n > 0 ? "text-green-dark" : "text-[#C45A12]";
}

type ChartBucket = PnlMetrics & {
  key: string;
  label: string;
  shortLabel: string;
};

function shiftMonthYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = addMonths(new Date(y, m - 1, 1, 12, 0, 0), delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const sheetCell =
  "border border-line px-2.5 py-2 text-[12px] tabular-nums text-ink";
const sheetHead =
  "border border-line bg-[#F3F5F4] px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink";
const sheetTotal =
  "border border-line bg-[#EEF3F0] px-2.5 py-2.5 text-[12px] font-semibold tabular-nums text-ink";
/** Geselecteerde eindperiode (eindweek / eindmaand uit de filter) */
const sheetSelected =
  "border border-line bg-[#E8F0EB] px-2.5 py-2 text-[12px] font-semibold tabular-nums text-ink";
const sheetSelectedLabel =
  "border border-line bg-[#E8F0EB] px-2.5 py-2 pl-5 text-left font-semibold text-ink shadow-[inset_4px_0_0_0_#0a4727]";
const sheetSelectedChild =
  "border border-line bg-[#F3F7F4] px-2.5 py-2 text-[12px] tabular-nums text-ink shadow-[inset_4px_0_0_0_#0a4727]";

function MetricsCells({
  m,
  tone = "cell",
}: {
  m: PnlMetrics;
  tone?: "cell" | "total" | "week" | "selected";
}) {
  const base =
    tone === "total"
      ? sheetTotal
      : tone === "selected"
        ? sheetSelected
        : tone === "week"
          ? `${sheetCell} bg-[#FAFBFA]`
          : sheetCell;
  return (
    <>
      <td className={`${base} whitespace-nowrap text-right`}>{num(m.orders)}</td>
      <td className={`${base} whitespace-nowrap text-right`}>
        {formatEuro(m.omzet)}
      </td>
      <td className={`${base} whitespace-nowrap text-right text-muted`}>
        {formatEuro(m.inkoop)}
      </td>
      <td className={`${base} whitespace-nowrap text-right text-muted`}>
        {formatEuro(m.installatie)}
      </td>
      <td className={`${base} whitespace-nowrap text-right text-muted`}>
        {formatEuro(m.sales_commissie)}
      </td>
      <td className={`${base} whitespace-nowrap text-right text-muted`}>
        {formatEuro(m.ops_commissie)}
      </td>
      <td className={`${base} whitespace-nowrap text-right text-muted`}>
        {formatEuro(m.ad_spend)}
      </td>
      <td className={`${base} whitespace-nowrap text-right text-muted`}>
        {formatEuro(m.totale_kosten)}
      </td>
      <td
        className={`${base} whitespace-nowrap text-right ${
          m.brutowinst >= 0 ? "text-green-dark" : "text-[#C45A12]"
        }`}
      >
        {formatEuro(m.brutowinst)}
      </td>
      <td className={`${base} whitespace-nowrap text-right`}>
        {fmtPct(m.marge_pct)}
      </td>
    </>
  );
}

const METRIC_HEADERS = (
  <>
    <th className={sheetHead}>Orders</th>
    <th className={sheetHead}>Omzet</th>
    <th className={sheetHead}>Inkoop</th>
    <th className={sheetHead}>Installatie</th>
    <th className={sheetHead}>Sales com.</th>
    <th className={sheetHead}>Com. ops</th>
    <th className={sheetHead}>Ads</th>
    <th className={sheetHead}>Kosten</th>
    <th className={sheetHead}>Winst</th>
    <th className={sheetHead}>Marge</th>
  </>
);

function TrendChart({
  buckets,
  compareLabel,
  selectedKey,
}: {
  buckets: ChartBucket[];
  compareLabel: string;
  selectedKey?: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverBi, setHoverBi] = useState<number | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);

  const maxOmzet = Math.max(1, ...buckets.map((b) => b.omzet));
  const maxWinst = Math.max(
    1,
    ...buckets.map((b) => Math.abs(b.brutowinst))
  );
  const maxMarge = Math.max(
    1,
    ...buckets.map((b) =>
      b.marge_pct != null && b.marge_pct > 0 ? b.marge_pct : 0
    )
  );
  const w = 1200;
  const h = 480;
  const padL = 28;
  const padR = 20;
  const padT = 24;
  const padB = 56;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const n = Math.max(1, buckets.length);
  const step = innerW / n;
  const barScale = 0.92;

  const margePts = buckets.map((bk, i) => {
    const x = padL + step * (i + 0.5);
    const r = bk.marge_pct;
    const y =
      r == null
        ? null
        : padT +
          innerH *
            (1 - (Math.min(maxMarge, Math.max(0, r)) / maxMarge) * barScale);
    return { x, y, r };
  });
  const lineD = margePts
    .filter((p): p is { x: number; y: number; r: number } => p.y != null)
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  function updateTipPos(e: MouseEvent) {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTipPos({ x: e.clientX - r.left, y: e.clientY - r.top });
  }

  function clearTip() {
    setHoverBi(null);
    setTipPos(null);
  }

  const tip = hoverBi != null ? buckets[hoverBi] ?? null : null;
  const tipPrev =
    hoverBi != null && hoverBi > 0 ? buckets[hoverBi - 1] ?? null : null;
  const tipDeltas = tip
    ? {
        omzet: pctChange(tip.omzet, tipPrev?.omzet),
        winst: pctChange(tip.brutowinst, tipPrev?.brutowinst),
        marge: pctChange(tip.marge_pct, tipPrev?.marge_pct),
        ads: pctChange(tip.ad_spend, tipPrev?.ad_spend),
        commissie: pctChange(tip.sales_commissie, tipPrev?.sales_commissie),
        ops: pctChange(tip.ops_commissie, tipPrev?.ops_commissie),
      }
    : null;
  const tipHasDelta =
    tipPrev != null &&
    tipDeltas != null &&
    Object.values(tipDeltas).some((d) => d != null);
  const tipStyle =
    tip && tipPos
      ? (() => {
          const box = wrapRef.current;
          const width = box?.clientWidth ?? 400;
          const height = box?.clientHeight ?? 320;
          const tipW = tipHasDelta ? 260 : 220;
          const tipH = tipHasDelta ? 240 : 200;
          const preferLeft = tipPos.x > width * 0.55;
          let left = preferLeft ? tipPos.x - tipW - 12 : tipPos.x + 12;
          let top = tipPos.y - tipH * 0.35;
          left = Math.max(4, Math.min(left, width - tipW - 4));
          top = Math.max(4, Math.min(top, height - tipH - 4));
          return { left, top, width: tipW } as const;
        })()
      : null;

  if (buckets.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Geen data.</p>;
  }

  const tipRows: {
    label: string;
    value: string;
    delta: number | null;
    emphasize?: boolean;
  }[] = tip
    ? [
        { label: "Orders", value: num(tip.orders), delta: null },
        {
          label: "Omzet",
          value: formatEuro(tip.omzet),
          delta: tipDeltas?.omzet ?? null,
        },
        {
          label: "Inkoop",
          value: formatEuro(tip.inkoop),
          delta: null,
        },
        {
          label: "Installatie",
          value: formatEuro(tip.installatie),
          delta: null,
        },
        {
          label: "Sales com.",
          value: formatEuro(tip.sales_commissie),
          delta: tipDeltas?.commissie ?? null,
        },
        {
          label: "Com. ops",
          value: formatEuro(tip.ops_commissie),
          delta: tipDeltas?.ops ?? null,
        },
        {
          label: "Ads",
          value: formatEuro(tip.ad_spend),
          delta: tipDeltas?.ads ?? null,
        },
        {
          label: "Winst",
          value: formatEuro(tip.brutowinst),
          delta: tipDeltas?.winst ?? null,
          emphasize: true,
        },
        {
          label: "Marge",
          value: fmtPct(tip.marge_pct),
          delta: tipDeltas?.marge ?? null,
        },
      ]
    : [];

  return (
    <div className="space-y-2">
      <div
        ref={wrapRef}
        className="relative overflow-hidden"
        onMouseLeave={clearTip}
      >
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="block h-52 w-full sm:h-64 lg:h-72"
          role="img"
          aria-label={`Projected P&L — vergelijking met ${compareLabel}`}
        >
          {buckets.map((bk, i) => {
            const cx = padL + step * (i + 0.5);
            const barW = Math.max(8, step * 0.34);
            const hOmzet = (bk.omzet / maxOmzet) * (innerH * barScale);
            const hWinst =
              (Math.abs(bk.brutowinst) / maxWinst) * (innerH * barScale);
            const base = padT + innerH;
            const selected = Boolean(selectedKey) && bk.key === selectedKey;
            const active = hoverBi === i || selected;
            const prev = i > 0 ? buckets[i - 1] : null;
            const dMarge = pctChange(bk.marge_pct, prev?.marge_pct);
            return (
              <g
                key={bk.key}
                className="cursor-pointer"
                onMouseEnter={(e) => {
                  setHoverBi(i);
                  updateTipPos(e);
                }}
                onMouseMove={(e) => {
                  setHoverBi(i);
                  updateTipPos(e);
                }}
              >
                <rect
                  x={cx - step * 0.45}
                  y={padT}
                  width={step * 0.9}
                  height={innerH}
                  fill={active ? "rgba(10,71,39,0.04)" : "transparent"}
                />
                {selected ? (
                  <rect
                    x={cx - step * 0.42}
                    y={h - 6}
                    width={step * 0.84}
                    height={4}
                    fill="#0a4727"
                    rx={1}
                  />
                ) : null}
                <rect
                  x={cx - barW}
                  y={base - hOmzet}
                  width={barW}
                  height={Math.max(1, hOmzet)}
                  fill="#A8D5B5"
                  opacity={active || hoverBi == null ? 1 : 0.45}
                />
                <rect
                  x={cx}
                  y={base - hWinst}
                  width={barW}
                  height={Math.max(1, hWinst)}
                  fill={bk.brutowinst >= 0 ? "#0a4727" : "#C45A12"}
                  opacity={active || hoverBi == null ? 1 : 0.45}
                />
                <text
                  x={cx}
                  y={h - 28}
                  textAnchor="middle"
                  className={selected ? "fill-ink font-semibold" : "fill-muted"}
                  fontSize={13}
                  fontWeight={700}
                >
                  {bk.shortLabel}
                </text>
                {dMarge != null ? (
                  <text
                    x={cx}
                    y={h - 10}
                    textAnchor="middle"
                    fill={
                      dMarge > 0 ? "#0a4727" : dMarge < 0 ? "#C45A12" : "#6b7280"
                    }
                    fontSize={12}
                    fontWeight={700}
                  >
                    {fmtPctDelta(dMarge)}
                  </text>
                ) : null}
              </g>
            );
          })}
          {lineD ? (
            <path
              d={lineD}
              fill="none"
              stroke="#C45A12"
              strokeWidth={3.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              pointerEvents="none"
            />
          ) : null}
        </svg>
        {tip && tipStyle ? (
          <div
            className="pointer-events-none absolute z-20 rounded-lg border border-line bg-white/95 px-2.5 py-2 text-[11px] shadow-md backdrop-blur-sm"
            style={tipStyle}
          >
            <p className="mb-1.5 font-semibold text-ink">{tip.label}</p>
            <div
              className={[
                "gap-x-3 gap-y-0.5 tabular-nums",
                tipHasDelta
                  ? "grid grid-cols-[auto_1fr_auto]"
                  : "grid grid-cols-[auto_1fr]",
              ].join(" ")}
            >
              {tipRows.map((row) => (
                <Fragment key={row.label}>
                  <span className="text-muted">{row.label}</span>
                  <span
                    className={[
                      "whitespace-nowrap text-right font-semibold",
                      row.emphasize ? "text-green-dark" : "text-ink",
                    ].join(" ")}
                  >
                    {row.value}
                  </span>
                  {tipHasDelta ? (
                    <span
                      className={`min-w-[2.75rem] whitespace-nowrap text-right font-semibold ${deltaTone(row.delta)}`}
                    >
                      {fmtPctDelta(row.delta)}
                    </span>
                  ) : null}
                </Fragment>
              ))}
            </div>
            {tipHasDelta ? (
              <p className="mt-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted">
                Δ vs {compareLabel}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-4 px-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#A8D5B5]" />
          Omzet
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#0a4727]" />
          Brutowinst
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 bg-[#C45A12]" />
          Marge %
        </span>
      </div>
    </div>
  );
}

export function ProjectedPnlPanel({
  rangeMode,
  rangeWeekKey,
  rangeMonthYm,
  hideRangeControls = false,
}: ProjectedPnlRangeProps = {}) {
  const today = todayConversieYmd();
  const [localMode, setLocalMode] = useState<RangeMode>("weeks");
  const [localWeekKey, setLocalWeekKey] = useState(() => {
    const w = schouwWeekFromDate(new Date(`${today}T12:00:00`));
    return schouwWeekValue(w.jaar, w.week);
  });
  const [localMonthYm, setLocalMonthYm] = useState(today.slice(0, 7));
  const mode = rangeMode ?? localMode;
  const weekKey = rangeWeekKey ?? localWeekKey;
  const monthYm = rangeMonthYm ?? localMonthYm;
  const setMode = setLocalMode;
  const setWeekKey = setLocalWeekKey;
  const setMonthYm = setLocalMonthYm;
  const [data, setData] = useState<PnlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set());
  const [openOpsLines, setOpenOpsLines] = useState<Set<string>>(new Set());

  const weekOptions = useMemo(() => {
    const base = agendaWeekJumpOptions(26, 2);
    if (weekKey && !base.some((o) => o.value === weekKey)) {
      const p = parseSchouwWeekValue(weekKey);
      if (p) {
        return [
          {
            value: weekKey,
            label: formatSchouwWeekLabel(p.jaar, p.week),
            jaar: p.jaar,
            week: p.week,
          },
          ...base,
        ];
      }
    }
    return base;
  }, [weekKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      const todayYmd = todayConversieYmd();
      if (mode === "month") {
        const startYm = shiftMonthYm(monthYm, -5);
        const from = conversieMonthRangeContaining(`${startYm}-01`).startYmd;
        let to = conversieMonthRangeContaining(`${monthYm}-01`).endYmd;
        if (to > todayYmd) to = todayYmd;
        qs.set("from", from);
        qs.set("to", to);
      } else {
        const parsed = parseSchouwWeekValue(weekKey);
        if (parsed) {
          const mon = String(
            schouwWeekToMondayIso(parsed.jaar, parsed.week)
          ).slice(0, 10);
          const [y, m, d] = mon.split("-").map(Number);
          const monNoon = fromZonedTime(
            new Date(y, m - 1, d, 12, 0, 0),
            AMSTERDAM_TZ
          );
          const startYmd = formatInTimeZone(
            addWeeks(monNoon, -11),
            AMSTERDAM_TZ,
            "yyyy-MM-dd"
          );
          let endYmd = formatInTimeZone(
            addDays(monNoon, 6),
            AMSTERDAM_TZ,
            "yyyy-MM-dd"
          );
          if (endYmd > todayYmd) endYmd = todayYmd;
          qs.set("from", startYmd);
          qs.set("to", endYmd);
        }
      }
      const res = await fetch(`/api/rapportage/projected-pnl?${qs}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Laden mislukt"
        );
      }
      const payload = json as PnlData;
      setData(payload);
      if (mode === "month") {
        const focusMonth =
          payload.months.find((m) => m.monthKey === monthYm) ||
          payload.months[0];
        if (focusMonth?.monthKey) {
          setOpenMonths(new Set([focusMonth.monthKey]));
          setOpenWeeks(new Set());
        }
      } else {
        const focusMonth =
          payload.months.find((m) =>
            m.weeks.some((w) => w.weekKey === weekKey)
          ) || payload.months[payload.months.length - 1];
        if (focusMonth?.monthKey) {
          setOpenMonths(new Set([focusMonth.monthKey]));
          const openKey =
            focusMonth.weeks.find((w) => w.weekKey === weekKey)?.weekKey ||
            focusMonth.weeks[focusMonth.weeks.length - 1]?.weekKey;
          setOpenWeeks(openKey ? new Set([openKey]) : new Set());
        }
      }
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [mode, monthYm, weekKey]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleMonth(key: string) {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleWeek(key: string) {
    setOpenWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleOpsLine(key: string) {
    setOpenOpsLines((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const chartBuckets: ChartBucket[] = useMemo(() => {
    if (!data) return [];
    if (mode === "month") {
      const months = [...data.months]
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        .map((m) => ({
          ...m,
          key: m.monthKey,
          label: m.label,
          shortLabel: (() => {
            const [y, mo] = m.monthKey.split("-");
            const names = [
              "jan",
              "feb",
              "mrt",
              "apr",
              "mei",
              "jun",
              "jul",
              "aug",
              "sep",
              "okt",
              "nov",
              "dec",
            ];
            const idx = Number(mo) - 1;
            return `${names[idx] ?? mo}’${y.slice(2)}`;
          })(),
        }));
      const first = months.findIndex(
        (m) => m.orders > 0 || m.omzet > 0 || m.ad_spend > 0
      );
      return first > 0 ? months.slice(first) : months;
    }
    const weeks = data.series.map((w) => ({
      ...w,
      key: w.weekKey,
      label: w.label,
      shortLabel: w.weekKey.replace(/^\d{4}-/, "") || w.weekKey,
    }));
    const first = weeks.findIndex(
      (w) => w.orders > 0 || w.omzet > 0 || w.ad_spend > 0
    );
    return first > 0 ? weeks.slice(first) : weeks;
  }, [data, mode]);

  const compareLabel = mode === "month" ? "vorige maand" : "vorige week";
  const chartTitle = mode === "month" ? "Per maand" : "Per week";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold text-ink">
            Projected P&amp;L
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Bruto getekende orders · volle omzet, installatie, sales/ops-commissie
            &amp; ads — niet afhankelijk van installatie-status
          </p>
          {data?.periodLabel ? (
            <p className="mt-0.5 text-xs text-muted">{data.periodLabel}</p>
          ) : null}
        </div>
        {!hideRangeControls ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex gap-1 border border-line p-0.5">
              {(
                [
                  ["weeks", "Week"],
                  ["month", "Maand"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={[
                    "px-2.5 py-1.5 text-xs font-semibold transition",
                    mode === id
                      ? "bg-[#0a4727] text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === "month" ? (
              <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Maand
                <input
                  type="month"
                  value={monthYm}
                  onChange={(e) =>
                    setMonthYm(e.target.value || today.slice(0, 7))
                  }
                  className="border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink outline-none focus:border-green"
                />
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Eindweek
                <select
                  value={weekKey}
                  onChange={(e) => setWeekKey(e.target.value)}
                  className="min-w-[12rem] border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink outline-none focus:border-green"
                >
                  {weekOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
          {error}{" "}
          <button
            type="button"
            onClick={() => void load()}
            className="font-semibold underline"
          >
            Opnieuw
          </button>
        </p>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-muted">Laden…</p>
      ) : data ? (
        <>
          <section className="overflow-hidden rounded-2xl border border-line bg-white">
            <header className="border-b border-line px-4 py-3">
              <p className="font-display text-sm font-semibold text-ink">
                {chartTitle}
              </p>
            </header>
            <div className="px-1 py-3 sm:px-2">
              <TrendChart
                buckets={chartBuckets}
                compareLabel={compareLabel}
                selectedKey={mode === "month" ? monthYm : weekKey}
              />
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-line bg-white">
            <header className="border-b border-line px-4 py-3.5 sm:px-5">
              <p className="font-display text-base font-semibold text-ink">
                Kostenregels
              </p>
            </header>
            <div className="overflow-x-auto p-3 sm:p-4">
              {data.months.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  Geen data in deze periode.
                </p>
              ) : (
                <table className="w-full min-w-[1100px] border-collapse border border-line text-[12px]">
                  <thead>
                    <tr>
                      <th
                        className={`${sheetHead} sticky left-0 z-10 text-left`}
                      >
                        Periode
                      </th>
                      {METRIC_HEADERS}
                    </tr>
                  </thead>
                  <tbody>
                    {data.months.map((month) => {
                      const mOpen = openMonths.has(month.monthKey);
                      const monthSelected =
                        mode === "month" && month.monthKey === monthYm;
                      return (
                        <Fragment key={month.monthKey}>
                          <tr
                            className="cursor-pointer hover:bg-[#FAFBFA]"
                            onClick={() => toggleMonth(month.monthKey)}
                          >
                            <td
                              className={`${
                                monthSelected
                                  ? sheetSelectedLabel.replace("pl-5", "pl-2.5")
                                  : sheetTotal
                              } sticky left-0 z-[1] text-left capitalize`}
                            >
                              <span className="inline-flex items-center gap-1.5">
                                <span className="w-3 text-muted">
                                  {mOpen ? "▾" : "▸"}
                                </span>
                                {month.label}
                              </span>
                            </td>
                            <MetricsCells
                              m={month}
                              tone={monthSelected ? "selected" : "total"}
                            />
                          </tr>
                          {mOpen
                            ? month.weeks.map((wk) => {
                                const wOpen = openWeeks.has(wk.weekKey);
                                const weekSelected =
                                  mode === "weeks" && wk.weekKey === weekKey;
                                return (
                                  <Fragment key={wk.weekKey}>
                                    <tr
                                      className="cursor-pointer hover:bg-[#FAFBFA]"
                                      onClick={() => toggleWeek(wk.weekKey)}
                                    >
                                      <td
                                        className={`${
                                          weekSelected
                                            ? sheetSelectedLabel
                                            : `${sheetCell} bg-[#FAFBFA] pl-6 text-left font-medium`
                                        } sticky left-0 z-[1]`}
                                      >
                                        <span className="inline-flex items-center gap-1.5">
                                          <span className="w-3 text-muted">
                                            {wOpen ? "▾" : "▸"}
                                          </span>
                                          {wk.label}
                                        </span>
                                      </td>
                                      <MetricsCells
                                        m={wk}
                                        tone={
                                          weekSelected ? "selected" : "week"
                                        }
                                      />
                                    </tr>
                                    {wOpen
                                      ? wk.lines.map((line) => {
                                          const hasKids =
                                            Boolean(line.children?.length) &&
                                            line.key === "ops_commissie";
                                          const opsKey = `${wk.weekKey}:${line.key}`;
                                          const kidsOpen =
                                            hasKids && openOpsLines.has(opsKey);
                                          const bedragTone =
                                            line.tone === "pos" ||
                                            (line.tone === "net" &&
                                              line.bedrag >= 0)
                                              ? "text-green-dark"
                                              : line.tone === "neg" ||
                                                  line.bedrag < 0
                                                ? "text-[#C45A12]"
                                                : "text-ink";
                                          const labelCls = `${
                                            weekSelected
                                              ? sheetSelectedChild
                                              : sheetCell
                                          } sticky left-0 z-[1] whitespace-nowrap pl-10 text-left font-medium ${
                                            weekSelected ? "" : "bg-white"
                                          }`;
                                          const spacerCls = weekSelected
                                            ? sheetSelectedChild
                                            : sheetCell;
                                          return (
                                            <Fragment
                                              key={`${wk.weekKey}-${line.key}`}
                                            >
                                              <tr
                                                className={
                                                  hasKids
                                                    ? "cursor-pointer hover:bg-[#FAFBFA]"
                                                    : "hover:bg-[#FAFBFA]"
                                                }
                                                onClick={
                                                  hasKids
                                                    ? (e) => {
                                                        e.stopPropagation();
                                                        toggleOpsLine(opsKey);
                                                      }
                                                    : undefined
                                                }
                                              >
                                                <td className={labelCls}>
                                                  {hasKids ? (
                                                    <span className="inline-flex items-center gap-1.5">
                                                      <span className="w-3 text-muted">
                                                        {kidsOpen ? "▾" : "▸"}
                                                      </span>
                                                      {line.label}
                                                    </span>
                                                  ) : (
                                                    line.label
                                                  )}
                                                </td>
                                                <td
                                                  className={`${spacerCls} text-right text-muted`}
                                                  colSpan={8}
                                                />
                                                <td
                                                  className={`${spacerCls} whitespace-nowrap text-right font-semibold ${bedragTone}`}
                                                >
                                                  {formatEuro(line.bedrag)}
                                                </td>
                                                <td className={spacerCls} />
                                              </tr>
                                              {kidsOpen
                                                ? line.children!.map((child) => (
                                                    <tr
                                                      key={`${opsKey}-${child.key}`}
                                                      className="hover:bg-[#FAFBFA]"
                                                    >
                                                      <td
                                                        className={`${
                                                          weekSelected
                                                            ? sheetSelectedChild
                                                            : sheetCell
                                                        } sticky left-0 z-[1] whitespace-nowrap pl-14 text-left text-muted ${
                                                          weekSelected
                                                            ? ""
                                                            : "bg-white"
                                                        }`}
                                                      >
                                                        {child.label}
                                                      </td>
                                                      <td
                                                        className={`${spacerCls} text-right text-muted`}
                                                        colSpan={8}
                                                      />
                                                      <td
                                                        className={`${spacerCls} whitespace-nowrap text-right tabular-nums text-[#C45A12]`}
                                                      >
                                                        {formatEuro(
                                                          child.bedrag
                                                        )}
                                                      </td>
                                                      <td
                                                        className={spacerCls}
                                                      />
                                                    </tr>
                                                  ))
                                                : null}
                                            </Fragment>
                                          );
                                        })
                                      : null}
                                  </Fragment>
                                );
                              })
                            : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

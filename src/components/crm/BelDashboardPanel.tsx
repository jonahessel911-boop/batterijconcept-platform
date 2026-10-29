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
import { AMSTERDAM_TZ } from "@/lib/format";
import type {
  BelIngeplandPipeline,
  BelMetrics,
  BelMonthBucket,
  BelWeekBucket,
} from "@/lib/bel-rapportage";
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

type BelData = {
  startYmd: string;
  endYmd: string;
  periodLabel: string;
  totals: BelMetrics;
  series: BelWeekBucket[];
  months: BelMonthBucket[];
  pipeline14d?: BelIngeplandPipeline | null;
};

type RangeMode = "weeks" | "month";

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
  if (prev === 0) return curr === 0 ? 0 : null;
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

type ChartBucket = BelMetrics & {
  key: string;
  label: string;
  shortLabel: string;
};

function shiftMonthYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = addMonths(new Date(y, m - 1, 1, 12, 0, 0), delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-white p-3 sm:p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink sm:text-3xl">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

const sheetCell =
  "border border-line px-2.5 py-2 text-[12px] tabular-nums text-ink";
const sheetHead =
  "border border-line bg-[#F3F5F4] px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink";
const sheetTotal =
  "border border-line bg-[#EEF3F0] px-2.5 py-2.5 text-[12px] font-semibold tabular-nums text-ink";
const sheetSelected =
  "border border-line bg-[#E8F0EB] px-2.5 py-2 text-[12px] font-semibold tabular-nums text-ink";
const sheetSelectedLabel =
  "border border-line bg-[#E8F0EB] px-2.5 py-2 pl-5 text-left font-semibold text-ink shadow-[inset_4px_0_0_0_#0a4727]";

function MetricsCells({
  m,
  tone = "cell",
}: {
  m: BelMetrics;
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
  const uitvalHigh =
    m.annuleringsPct != null && m.annuleringsPct >= 20;
  return (
    <>
      <td className={`${base} whitespace-nowrap text-right`}>
        {num(m.gebeld)}
      </td>
      <td className={`${base} whitespace-nowrap text-right`}>
        {num(m.ingepland)}
      </td>
      <td
        className={`${base} whitespace-nowrap text-right text-green-dark`}
      >
        {fmtPct(m.leadToAppt)}
      </td>
      <td className={`${base} whitespace-nowrap text-right text-muted`}>
        {fmtPct(m.conv_gebeld_ingepland_pct)}
      </td>
      <td
        className={`${base} whitespace-nowrap text-right ${
          uitvalHigh ? "text-[#C45A12]" : ""
        }`}
        title={
          m.geannuleerd > 0
            ? `${m.geannuleerd} geannuleerd van ${m.ingepland + m.geannuleerd} geplaatst`
            : undefined
        }
      >
        {m.geannuleerd > 0 ? (
          <span className="tabular-nums">
            {num(m.geannuleerd)}
            <span className="ml-1 text-[11px] text-muted">
              ({fmtPct(m.annuleringsPct)})
            </span>
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className={`${base} whitespace-nowrap text-right`}>
        {num(m.geenInteresse)}
      </td>
      <td className={`${base} whitespace-nowrap text-right`}>
        {num(m.geenContact)}
      </td>
    </>
  );
}

const METRIC_HEADERS = (
  <>
    <th className={sheetHead}>Gebeld</th>
    <th className={sheetHead}>Ingepland</th>
    <th className={sheetHead}>L→A</th>
    <th className={sheetHead}>G→I</th>
    <th className={sheetHead} title="Geannuleerde huisbezoeken / uitval %">
      Uitval
    </th>
    <th className={sheetHead}>Geen int.</th>
    <th className={sheetHead}>Geen cont.</th>
  </>
);

function TrendChart({
  buckets,
  compareLabel,
}: {
  buckets: ChartBucket[];
  compareLabel: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverBi, setHoverBi] = useState<number | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);

  const maxGebeld = Math.max(1, ...buckets.map((b) => b.gebeld));
  const maxIngepland = Math.max(1, ...buckets.map((b) => b.ingepland));
  const maxConv = Math.max(
    1,
    ...buckets.map((b) =>
      b.leadToAppt != null && b.leadToAppt > 0 ? b.leadToAppt : 0
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

  const convPts = buckets.map((bk, i) => {
    const x = padL + step * (i + 0.5);
    const r = bk.leadToAppt;
    const y =
      r == null
        ? null
        : padT +
          innerH *
            (1 - (Math.min(maxConv, Math.max(0, r)) / maxConv) * barScale);
    return { x, y, r };
  });
  const lineD = convPts
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
        gebeld: pctChange(tip.gebeld, tipPrev?.gebeld),
        ingepland: pctChange(tip.ingepland, tipPrev?.ingepland),
        l2a: pctChange(tip.leadToAppt, tipPrev?.leadToAppt),
        bruto: pctChange(
          tip.conv_gebeld_ingepland_pct,
          tipPrev?.conv_gebeld_ingepland_pct
        ),
        geenInt: pctChange(tip.geenInteresse, tipPrev?.geenInteresse),
        geenCont: pctChange(tip.geenContact, tipPrev?.geenContact),
      }
    : null;
  const tipStyle =
    tip && tipPos
      ? (() => {
          const box = wrapRef.current;
          const width = box?.clientWidth ?? 400;
          const height = box?.clientHeight ?? 320;
          const tipW = 220;
          const tipH = tipPrev ? 190 : 140;
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
        {
          label: "Gebeld",
          value: num(tip.gebeld),
          delta: tipDeltas?.gebeld ?? null,
        },
        {
          label: "Ingepland",
          value: num(tip.ingepland),
          delta: tipDeltas?.ingepland ?? null,
        },
        {
          label: "L→A",
          value: fmtPct(tip.leadToAppt),
          delta: tipDeltas?.l2a ?? null,
          emphasize: true,
        },
        {
          label: "G→I",
          value: fmtPct(tip.conv_gebeld_ingepland_pct),
          delta: tipDeltas?.bruto ?? null,
        },
        {
          label: "Geen int.",
          value: num(tip.geenInteresse),
          delta: tipDeltas?.geenInt ?? null,
        },
        {
          label: "Geen cont.",
          value: num(tip.geenContact),
          delta: tipDeltas?.geenCont ?? null,
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
          aria-label={`Callcenter trend — vergelijking met ${compareLabel}`}
        >
          {buckets.map((bk, i) => {
            const cx = padL + step * (i + 0.5);
            const barW = Math.max(8, step * 0.34);
            const hGebeld = (bk.gebeld / maxGebeld) * (innerH * barScale);
            const hIng = (bk.ingepland / maxIngepland) * (innerH * barScale);
            const base = padT + innerH;
            const active = hoverBi === i;
            const prev = i > 0 ? buckets[i - 1] : null;
            const dConv = pctChange(bk.leadToAppt, prev?.leadToAppt);
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
                <rect
                  x={cx - barW}
                  y={base - hGebeld}
                  width={barW}
                  height={Math.max(1, hGebeld)}
                  fill="#A8D5B5"
                  opacity={active || hoverBi == null ? 1 : 0.45}
                />
                <rect
                  x={cx}
                  y={base - hIng}
                  width={barW}
                  height={Math.max(1, hIng)}
                  fill="#0a4727"
                  opacity={active || hoverBi == null ? 1 : 0.45}
                />
                <text
                  x={cx}
                  y={h - 28}
                  textAnchor="middle"
                  className="fill-muted"
                  fontSize={13}
                  fontWeight={700}
                >
                  {bk.shortLabel}
                </text>
                {dConv != null ? (
                  <text
                    x={cx}
                    y={h - 10}
                    textAnchor="middle"
                    fill={
                      dConv > 0 ? "#0a4727" : dConv < 0 ? "#C45A12" : "#6b7280"
                    }
                    fontSize={12}
                    fontWeight={700}
                  >
                    {fmtPctDelta(dConv)}
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
            <p className="mb-1.5 truncate font-semibold text-ink">{tip.label}</p>
            <div className="grid grid-cols-[auto_1fr_auto] gap-x-2 gap-y-0.5 tabular-nums">
              {tipRows.map((row) => (
                <Fragment key={row.label}>
                  <span className="text-muted">{row.label}</span>
                  <span
                    className={[
                      "text-right font-semibold",
                      row.emphasize ? "text-green-dark" : "text-ink",
                    ].join(" ")}
                  >
                    {row.value}
                  </span>
                  <span
                    className={`min-w-[2.75rem] text-right font-semibold ${
                      tipPrev ? deltaTone(row.delta) : "text-transparent"
                    }`}
                  >
                    {tipPrev ? fmtPctDelta(row.delta) : "·"}
                  </span>
                </Fragment>
              ))}
            </div>
            {tipPrev ? (
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
          Gebeld
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#0a4727]" />
          Ingepland
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 bg-[#C45A12]" />
          L→A %
        </span>
      </div>
    </div>
  );
}

export type BelDashboardRangeProps = {
  rangeMode?: RangeMode;
  rangeWeekKey?: string;
  rangeMonthYm?: string;
  hideRangeControls?: boolean;
};

export function BelDashboardPanel({
  rangeMode,
  rangeWeekKey,
  rangeMonthYm,
  hideRangeControls = false,
}: BelDashboardRangeProps = {}) {
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
  const [data, setData] = useState<BelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set());

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
      const res = await fetch(`/api/rapportage/bel?${qs}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Laden mislukt"
        );
      }
      const payload = json as BelData;
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

  const t = useMemo(() => {
    if (!data) return null;
    if (mode === "month") {
      const m = data.months.find((x) => x.monthKey === monthYm);
      return m ?? data.totals;
    }
    return data.totals;
  }, [data, mode, monthYm]);

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
        (m) => m.gebeld > 0 || m.ingepland > 0
      );
      return first > 0 ? months.slice(first) : months;
    }
    // Weekview: afgelopen 12 weken, start bij eerste week mét data
    const weeks = data.series.map((w) => ({
      ...w,
      key: w.weekKey,
      label: w.label,
      shortLabel: w.weekKey.replace(/^\d{4}-/, "") || w.weekKey,
    }));
    const first = weeks.findIndex(
      (w) =>
        w.gebeld > 0 ||
        w.ingepland > 0 ||
        w.geenInteresse > 0 ||
        w.geenContact > 0
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
            Callcenter
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
            <Kpi label="Gebeld" value={num(t?.gebeld)} />
            <Kpi label="Ingepland" value={num(t?.ingepland)} />
            <Kpi label="L→A" value={fmtPct(t?.leadToAppt)} />
            <Kpi
              label="Conv. G→I"
              value={fmtPct(t?.conv_gebeld_ingepland_pct)}
            />
            <Kpi
              label="Uitval"
              value={
                (t?.geannuleerd || 0) > 0
                  ? `${num(t?.geannuleerd)} (${fmtPct(t?.annuleringsPct)})`
                  : "—"
              }
            />
            <Kpi label="Geen interesse" value={num(t?.geenInteresse)} />
            <Kpi label="Geen contact" value={num(t?.geenContact)} />
          </div>

          <section className="overflow-hidden rounded-2xl border border-line bg-white">
            <header className="border-b border-line px-4 py-3">
              <p className="font-display text-sm font-semibold text-ink">
                {chartTitle}
              </p>
            </header>
            <div className="px-1 py-3 sm:px-2">
              <TrendChart buckets={chartBuckets} compareLabel={compareLabel} />
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-line bg-white">
            <header className="border-b border-line px-4 py-3.5 sm:px-5">
              <p className="font-display text-base font-semibold text-ink">
                Bellers
              </p>
            </header>
            <div className="overflow-x-auto p-3 sm:p-4">
              {data.months.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  Geen data in deze periode.
                </p>
              ) : (
                <table className="w-full min-w-[720px] border-collapse border border-line text-[12px]">
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
                                      ? wk.bellers.length === 0
                                        ? (
                                            <tr>
                                              <td
                                                className={`${sheetCell} pl-10 text-left text-muted`}
                                                colSpan={8}
                                              >
                                                Geen bellers
                                              </td>
                                            </tr>
                                          )
                                        : wk.bellers.map((b) => (
                                            <tr
                                              key={`${wk.weekKey}-${b.key}`}
                                              className="hover:bg-[#FAFBFA]"
                                            >
                                              <td
                                                className={`${sheetCell} sticky left-0 z-[1] max-w-[18rem] bg-white pl-10 text-left font-medium`}
                                              >
                                                <span
                                                  className="truncate"
                                                  title={b.label}
                                                >
                                                  {b.label}
                                                </span>
                                              </td>
                                              <MetricsCells m={b} />
                                            </tr>
                                          ))
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

          {data.pipeline14d ? (
            <section className="overflow-hidden rounded-2xl border border-line bg-white">
              <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
                <div>
                  <p className="font-display text-base font-semibold text-ink">
                    Ingepland afgelopen{" "}
                    {data.pipeline14d.bookedDays ?? 7} dagen
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    Huisbezoeken geboekt{" "}
                    {data.pipeline14d.geboektVanYmd} t/m{" "}
                    {data.pipeline14d.fromYmd}, met bezoekdatum in de komende{" "}
                    {data.pipeline14d.days} dagen (
                    {data.pipeline14d.fromYmd} t/m {data.pipeline14d.toYmd}) —
                    per kalenderweek van het bezoek.
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-4 sm:gap-6">
                  <div className="text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Geboekt laatste {data.pipeline14d.bookedDays ?? 7}d
                    </p>
                    <p className="font-display text-2xl font-semibold tabular-nums text-ink">
                      {num(data.pipeline14d.geboektLaatsteDagen ?? 0)}
                    </p>
                    <p className="text-[11px] text-muted">
                      voor komende {data.pipeline14d.days}d
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Totaal in agenda
                    </p>
                    <p className="font-display text-2xl font-semibold tabular-nums text-ink">
                      {num(data.pipeline14d.total)}
                    </p>
                    <p className="text-[11px] text-muted">
                      komende {data.pipeline14d.days}d
                    </p>
                  </div>
                </div>
              </header>
              <div className="grid gap-2 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3">
                {data.pipeline14d.weeks.map((w) => (
                  <div
                    key={w.weekKey}
                    className="rounded-xl border border-line bg-[#FAFBFA] px-3.5 py-3"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                      {w.weekKey}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {w.label}
                    </p>
                    <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-ink">
                      {num(w.count)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      geboekt laatste {data.pipeline14d?.bookedDays ?? 7}d ·{" "}
                      {w.startYmd} – {w.endYmd}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

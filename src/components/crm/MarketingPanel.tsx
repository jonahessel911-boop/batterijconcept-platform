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
import Image from "next/image";
import { AMSTERDAM_TZ, formatEuro } from "@/lib/format";
import type {
  MarketingMetrics,
  MarketingMonthBucket,
  MarketingWeekBucket,
} from "@/lib/marketing-rapportage";
import { normalizeCampaignKey } from "@/lib/marketing-rapportage";
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

type MarketingData = {
  startYmd: string;
  endYmd: string;
  periodLabel: string;
  totals: MarketingMetrics;
  series: MarketingWeekBucket[];
  months: MarketingMonthBucket[];
  metaConfigured: boolean;
  lastSyncAt: string | null;
  metaMissing?: string[];
  metaCampaigns?: string[];
};

type RangeMode = "weeks" | "month";

function fmtRoas(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toLocaleString("nl-NL", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}x`;
}

function num(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL");
}

/** % t.o.v. vorige periode; null als niet berekenbaar. */
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

type ChartBucket = MarketingMetrics & {
  key: string;
  label: string;
  shortLabel: string;
  /** Cumulatieve leads t/m deze bucket (dag-drill: schema) */
  cumLeads?: number;
  /** Cumulatief leads-doel t/m deze bucket (lineair over de week) */
  cumLeadsNodig?: number;
};

function shiftMonthYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = addMonths(new Date(y, m - 1, 1, 12, 0, 0), delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function MetaMark({ className = "h-3.5 w-5" }: { className?: string }) {
  return (
    <Image
      src="/brands/meta.svg"
      alt="Meta"
      width={20}
      height={14}
      className={className}
      unoptimized
    />
  );
}

function isMetaCampaign(
  label: string,
  metaNormKeys: Set<string>
): boolean {
  if (!label || label === "Onbekend") return false;
  if (metaNormKeys.size === 0) {
    // Fallback: typische Meta-naam of spend-campagne zonder lijst
    return /batterij|meta|facebook|campaign/i.test(label);
  }
  return metaNormKeys.has(normalizeCampaignKey(label));
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
  m: MarketingMetrics;
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
      <td className={`${base} whitespace-nowrap text-right`}>
        {formatEuro(m.spend)}
      </td>
      <td className={`${base} whitespace-nowrap text-right`}>{num(m.leads)}</td>
      <td className={`${base} whitespace-nowrap text-right text-muted`}>
        {m.cpl != null ? formatEuro(m.cpl) : "—"}
      </td>
      <td className={`${base} whitespace-nowrap text-right`}>
        {num(m.afspraken)}
      </td>
      <td className={`${base} whitespace-nowrap text-right text-muted`}>
        {m.cpa != null ? formatEuro(m.cpa) : "—"}
      </td>
      <td className={`${base} whitespace-nowrap text-right`}>{num(m.deals)}</td>
      <td className={`${base} whitespace-nowrap text-right text-muted`}>
        {m.cac != null ? formatEuro(m.cac) : "—"}
      </td>
      <td className={`${base} whitespace-nowrap text-right`}>
        {formatEuro(m.omzet)}
      </td>
      <td className={`${base} whitespace-nowrap text-right text-muted`}>
        {m.rpa != null ? formatEuro(m.rpa) : "—"}
      </td>
      <td
        className={`${base} whitespace-nowrap text-right text-green-dark`}
      >
        {fmtRoas(m.roas)}
      </td>
    </>
  );
}

const METRIC_HEADERS = (
  <>
    <th className={sheetHead}>Spend</th>
    <th className={sheetHead}>Leads</th>
    <th className={sheetHead}>CPL</th>
    <th className={sheetHead}>Afspr.</th>
    <th className={sheetHead}>CPA</th>
    <th className={sheetHead}>Deals</th>
    <th className={sheetHead}>CPD</th>
    <th className={sheetHead}>Omzet</th>
    <th className={sheetHead}>RPA</th>
    <th className={sheetHead}>ROAS</th>
  </>
);

function TrendChart({
  buckets,
  compareLabel,
  onBucketClick,
  paceMode = false,
}: {
  buckets: ChartBucket[];
  /** "vorige week" | "vorige maand" | "vorige dag" */
  compareLabel: string;
  onBucketClick?: (bucket: ChartBucket) => void;
  /** Dag-drill: oranje lijn = cumulatief weekdoel (op schema) */
  paceMode?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverBi, setHoverBi] = useState<number | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);

  const maxSpend = Math.max(1, ...buckets.map((b) => b.spend));
  // Staven: dagelijkse/wekelijkse leads (+ dagtotaal-doel)
  const maxLeads = Math.max(
    1,
    ...buckets.map((b) => b.leads),
    ...buckets.map((b) =>
      b.leadsNodig != null && b.leadsNodig > 0 ? b.leadsNodig : 0
    )
  );
  // Schema-lijnen (cumulatief) op eigen schaal zodat staven leesbaar blijven
  const maxPace = Math.max(
    1,
    ...buckets.map((b) => b.cumLeads ?? 0),
    ...buckets.map((b) =>
      b.cumLeadsNodig != null && b.cumLeadsNodig > 0 ? b.cumLeadsNodig : 0
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

  function yForLeads(v: number) {
    return (
      padT +
      innerH * (1 - (Math.min(maxLeads, Math.max(0, v)) / maxLeads) * barScale)
    );
  }
  function yForPace(v: number) {
    return (
      padT +
      innerH * (1 - (Math.min(maxPace, Math.max(0, v)) / maxPace) * barScale)
    );
  }

  // Oranje lijn = leads nodig (week) of cumulatief schema (dag-drill)
  const needPts = buckets.map((bk, i) => {
    const x = padL + step * (i + 0.5);
    const nNeed = paceMode ? bk.cumLeadsNodig : bk.leadsNodig;
    const y =
      nNeed == null || nNeed <= 0
        ? null
        : paceMode
          ? yForPace(nNeed)
          : yForLeads(nNeed);
    return { x, y, nNeed };
  });
  const lineD = needPts
    .filter(
      (p): p is { x: number; y: number; nNeed: number } => p.y != null
    )
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  // Cumulatieve actuals (alleen paceMode) — tweede lijn om schema te zien
  const cumActualD = paceMode
    ? buckets
        .map((bk, i) => {
          const x = padL + step * (i + 0.5);
          const y = yForPace(bk.cumLeads ?? 0);
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ")
    : "";

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
        spend: pctChange(tip.spend, tipPrev?.spend),
        leads: pctChange(tip.leads, tipPrev?.leads),
        afspraken: pctChange(tip.afspraken, tipPrev?.afspraken),
        cpl: pctChange(tip.cpl, tipPrev?.cpl),
        cpa: pctChange(tip.cpa, tipPrev?.cpa),
        cac: pctChange(tip.cac, tipPrev?.cac),
        omzet: pctChange(tip.omzet, tipPrev?.omzet),
        rpa: pctChange(tip.rpa, tipPrev?.rpa),
        roas: pctChange(tip.roas, tipPrev?.roas),
      }
    : null;
  const tipStyle =
    tip && tipPos
      ? (() => {
          const box = wrapRef.current;
          const width = box?.clientWidth ?? 400;
          const height = box?.clientHeight ?? 320;
          const tipW = tip?.leadsNodig != null ? 268 : 228;
          const tipH = tipPrev ? 250 : 190;
          const preferLeft = tipPos.x > width * 0.55;
          let left = preferLeft
            ? tipPos.x - tipW - 12
            : tipPos.x + 12;
          let top = tipPos.y - tipH * 0.35;
          left = Math.max(4, Math.min(left, width - tipW - 4));
          top = Math.max(4, Math.min(top, height - tipH - 4));
          return { left, top, width: tipW } as const;
        })()
      : null;

  if (buckets.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">Geen data.</p>
    );
  }

  const tipRows: {
    label: string;
    huidig: string;
    doel: string | null;
    delta: number | null;
  }[] = tip
    ? [
        {
          label: "Spend",
          huidig: formatEuro(tip.spend),
          doel: null,
          delta: tipDeltas?.spend ?? null,
        },
        {
          label: "Leads",
          huidig: num(tip.leads),
          doel: tip.leadsNodig != null ? num(tip.leadsNodig) : null,
          delta: tipDeltas?.leads ?? null,
        },
        {
          label: "Afspr.",
          huidig: num(tip.afspraken),
          doel: null,
          delta: tipDeltas?.afspraken ?? null,
        },
        {
          label: "CPL",
          huidig: tip.cpl != null ? formatEuro(tip.cpl) : "—",
          doel: null,
          delta: tipDeltas?.cpl ?? null,
        },
        {
          label: "CPA",
          huidig: tip.cpa != null ? formatEuro(tip.cpa) : "—",
          doel: null,
          delta: tipDeltas?.cpa ?? null,
        },
        {
          label: "CPD",
          huidig: tip.cac != null ? formatEuro(tip.cac) : "—",
          doel: null,
          delta: tipDeltas?.cac ?? null,
        },
        {
          label: "Omzet",
          huidig: formatEuro(tip.omzet),
          doel: null,
          delta: tipDeltas?.omzet ?? null,
        },
        {
          label: "ROAS",
          huidig: fmtRoas(tip.roas),
          doel: null,
          delta: tipDeltas?.roas ?? null,
        },
      ]
    : [];
  const showDoelCol = tipRows.some((r) => r.doel != null);
  const showDeltaCol = Boolean(tipPrev);

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
          aria-label={`Marketing trend — vergelijking met ${compareLabel}`}
        >
          {buckets.map((bk, i) => {
            const cx = padL + step * (i + 0.5);
            const barW = Math.max(8, step * 0.34);
            const hSpend = (bk.spend / maxSpend) * (innerH * barScale);
            const hLeads = (bk.leads / maxLeads) * (innerH * barScale);
            const base = padT + innerH;
            const active = hoverBi === i;
            const prev = i > 0 ? buckets[i - 1] : null;
            const dLeads = pctChange(bk.leads, prev?.leads);
            return (
              <g
                key={bk.key}
                className={onBucketClick ? "cursor-pointer" : "cursor-default"}
                onMouseEnter={(e) => {
                  setHoverBi(i);
                  updateTipPos(e);
                }}
                onMouseMove={(e) => {
                  setHoverBi(i);
                  updateTipPos(e);
                }}
                onClick={() => onBucketClick?.(bk)}
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
                  y={base - hSpend}
                  width={barW}
                  height={Math.max(1, hSpend)}
                  fill="#A8D5B5"
                  opacity={active || hoverBi == null ? 1 : 0.45}
                />
                <rect
                  x={cx}
                  y={base - hLeads}
                  width={barW}
                  height={Math.max(1, hLeads)}
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
                {dLeads != null ? (
                  <text
                    x={cx}
                    y={h - 10}
                    textAnchor="middle"
                    fill={
                      dLeads > 0 ? "#0a4727" : dLeads < 0 ? "#C45A12" : "#6b7280"
                    }
                    fontSize={12}
                    fontWeight={700}
                  >
                    {fmtPctDelta(dLeads)}
                  </text>
                ) : null}
              </g>
            );
          })}
          {cumActualD ? (
            <path
              d={cumActualD}
              fill="none"
              stroke="#0a4727"
              strokeWidth={2.5}
              strokeDasharray="6 4"
              strokeLinejoin="round"
              strokeLinecap="round"
              pointerEvents="none"
              opacity={0.85}
            />
          ) : null}
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
            <p className="mb-1.5 flex items-center gap-1.5 truncate font-semibold text-ink">
              <MetaMark className="h-3 w-[18px] shrink-0" />
              <span className="truncate">{tip.label}</span>
            </p>
            <table className="w-full border-collapse text-[11px] tabular-nums">
              <thead>
                <tr className="text-[9px] font-semibold uppercase tracking-wide text-muted">
                  <th className="pb-1 pr-2 text-left font-semibold" />
                  <th className="pb-1 pl-2 text-right font-semibold">Huidig</th>
                  {showDoelCol ? (
                    <th className="pb-1 pl-2 text-right font-semibold">Doel</th>
                  ) : null}
                  {showDeltaCol ? (
                    <th className="pb-1 pl-2 text-right font-semibold">Δ</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {tipRows.map((row) => (
                  <tr key={row.label}>
                    <td className="py-0.5 pr-2 text-left text-muted">
                      {row.label}
                    </td>
                    <td className="py-0.5 pl-2 text-right font-semibold text-ink">
                      {row.huidig}
                    </td>
                    {showDoelCol ? (
                      <td
                        className={`py-0.5 pl-2 text-right font-semibold ${
                          row.doel != null ? "text-green-dark" : "text-muted/40"
                        }`}
                      >
                        {row.doel ?? "—"}
                      </td>
                    ) : null}
                    {showDeltaCol ? (
                      <td
                        className={`py-0.5 pl-2 text-right font-semibold ${deltaTone(row.delta)}`}
                      >
                        {fmtPctDelta(row.delta)}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {paceMode && tip.cumLeads != null && tip.cumLeadsNodig != null ? (
              <p className="mt-1.5 text-[10px] tabular-nums text-muted">
                Cum.{" "}
                <span className="font-semibold text-ink">
                  {num(tip.cumLeads)}
                </span>
                {" / "}
                <span className="font-semibold text-[#C45A12]">
                  {num(tip.cumLeadsNodig)}
                </span>
                {tip.cumLeads >= tip.cumLeadsNodig ? (
                  <span className="ml-1 font-semibold text-green-dark">
                    op schema
                  </span>
                ) : (
                  <span className="ml-1 font-semibold text-[#C45A12]">
                    −{num(tip.cumLeadsNodig - tip.cumLeads)}
                  </span>
                )}
              </p>
            ) : null}
            {tipPrev ? (
              <p className="mt-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted">
                Δ vs {compareLabel}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type MarketingPanelRangeProps = {
  rangeMode?: RangeMode;
  rangeWeekKey?: string;
  rangeMonthYm?: string;
  hideRangeControls?: boolean;
};

export function MarketingPanel({
  rangeMode,
  rangeWeekKey,
  rangeMonthYm,
  hideRangeControls = false,
}: MarketingPanelRangeProps = {}) {
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
  const [data, setData] = useState<MarketingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set());
  /** Week-key waarnaar is ingezoomd (dag-breakdown); null = weekoverzicht */
  const [drillWeekKey, setDrillWeekKey] = useState<string | null>(null);

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

  const load = useCallback(async (opts?: { sync?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      const todayYmd = todayConversieYmd();
      if (mode === "month") {
        // 6 maanden t/m geselecteerde maand → grafiek per maand + MoM %
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
      if (opts?.sync) qs.set("sync", "1");
      const res = await fetch(`/api/rapportage/marketing?${qs}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Laden mislukt"
        );
      }
      const payload = json as MarketingData;
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
      setSyncing(false);
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

  const metaNormKeys = useMemo(() => {
    const set = new Set<string>();
    for (const name of data?.metaCampaigns || []) {
      if (name.trim()) set.add(normalizeCampaignKey(name));
    }
    return set;
  }, [data?.metaCampaigns]);

  /** KPI’s: geselecteerde maand of totale weekreeks. */
  const t = useMemo(() => {
    if (!data) return null;
    if (mode === "month") {
      const m = data.months.find((x) => x.monthKey === monthYm);
      return m ?? data.totals;
    }
    return data.totals;
  }, [data, mode, monthYm]);

  const drillWeek = useMemo(() => {
    if (!data || !drillWeekKey || mode !== "weeks") return null;
    return data.series.find((w) => w.weekKey === drillWeekKey) ?? null;
  }, [data, drillWeekKey, mode]);

  const chartBuckets: ChartBucket[] = useMemo(() => {
    if (!data) return [];
    if (mode === "month") {
      const months = [...data.months]
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        .map((m) => ({
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
          spend: m.spend,
          leads: m.leads,
          afspraken: m.afspraken,
          deals: m.deals,
          omzet: m.omzet,
          cpl: m.cpl,
          cpa: m.cpa,
          cac: m.cac,
          rpa: m.rpa,
          roas: m.roas,
          roi: m.roi,
          leadsNodig: m.leadsNodig ?? null,
        }));
      const first = months.findIndex(
        (m) => m.spend > 0 || m.leads > 0 || m.afspraken > 0 || m.deals > 0
      );
      return first > 0 ? months.slice(first) : months;
    }

    // Dag-drill: alle dagen van de aangeklikte week + cumulatief schema
    if (drillWeek) {
      const weekNeed = drillWeek.leadsNodig ?? 0;
      const nDays = 7;
      let cumLeads = 0;
      return (drillWeek.days || []).map((d, i) => {
        cumLeads += d.leads;
        const cumLeadsNodig =
          weekNeed > 0
            ? Math.round((weekNeed * (i + 1)) / nDays)
            : d.leadsNodig ?? null;
        const dayParts = d.label.split(/\s+/);
        const shortLabel =
          dayParts.length >= 2
            ? `${dayParts[0].replace(/\.$/, "")} ${dayParts[1]}`
            : d.dayKey.slice(8);
        return {
          key: d.dayKey,
          label: d.label,
          shortLabel,
          spend: d.spend,
          leads: d.leads,
          afspraken: d.afspraken,
          deals: d.deals,
          omzet: d.omzet,
          cpl: d.cpl,
          cpa: d.cpa,
          cac: d.cac,
          rpa: d.rpa,
          roas: d.roas,
          roi: d.roi,
          leadsNodig: d.leadsNodig ?? null,
          cumLeads,
          cumLeadsNodig: cumLeadsNodig ?? undefined,
        };
      });
    }

    // Weekview: afgelopen 12 weken, start bij eerste week mét data
    const weeks = data.series.map((w) => ({
      key: w.weekKey,
      label: w.label,
      shortLabel: w.weekKey.replace(/^\d{4}-/, "") || w.weekKey,
      spend: w.spend,
      leads: w.leads,
      afspraken: w.afspraken,
      deals: w.deals,
      omzet: w.omzet,
      cpl: w.cpl,
      cpa: w.cpa,
      cac: w.cac,
      rpa: w.rpa,
      roas: w.roas,
      roi: w.roi,
      leadsNodig: w.leadsNodig ?? null,
    }));
    const first = weeks.findIndex(
      (w) => w.spend > 0 || w.leads > 0 || w.afspraken > 0 || w.deals > 0
    );
    return first > 0 ? weeks.slice(first) : weeks;
  }, [data, mode, drillWeek]);

  const compareLabel = drillWeek
    ? "vorige dag"
    : mode === "month"
      ? "vorige maand"
      : "vorige week";
  const chartTitle = drillWeek
    ? drillWeek.label
    : mode === "month"
      ? "Per maand"
      : "Per week";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
            <MetaMark className="h-4 w-6" />
            Marketing
          </p>
          {data?.periodLabel ? (
            <p className="mt-0.5 text-xs text-muted">{data.periodLabel}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {!hideRangeControls ? (
            <>
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
                    onClick={() => {
                      setMode(id);
                      setDrillWeekKey(null);
                    }}
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
                    onChange={(e) => {
                      setWeekKey(e.target.value);
                      setDrillWeekKey(null);
                    }}
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
            </>
          ) : null}
          <button
            type="button"
            disabled={loading || syncing}
            onClick={() => {
              setSyncing(true);
              void load({ sync: true });
            }}
            className="border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
            title="Meta spend syncen voor deze periode"
          >
            {syncing ? "Sync…" : "Meta sync"}
          </button>
        </div>
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

      {!data?.metaConfigured ? (
        <p className="rounded-xl border border-line bg-wash px-4 py-3 text-xs text-muted">
          Meta Ads niet geconfigureerd
          {data?.metaMissing?.length
            ? ` (${data.metaMissing.join(", ")})`
            : ""}
          . Spend blijft 0 tot sync + env kloppen.
        </p>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-muted">Laden…</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-10">
            <Kpi label="Spend" value={formatEuro(t?.spend ?? 0)} />
            <Kpi label="Leads" value={num(t?.leads)} />
            <Kpi
              label="CPL"
              value={t?.cpl != null ? formatEuro(t.cpl) : "—"}
            />
            <Kpi label="Afspraken" value={num(t?.afspraken)} />
            <Kpi
              label="CPA"
              value={t?.cpa != null ? formatEuro(t.cpa) : "—"}
            />
            <Kpi label="Deals" value={num(t?.deals)} />
            <Kpi
              label="CPD"
              value={t?.cac != null ? formatEuro(t.cac) : "—"}
            />
            <Kpi label="Omzet" value={formatEuro(t?.omzet ?? 0)} />
            <Kpi
              label="RPA"
              value={t?.rpa != null ? formatEuro(t.rpa) : "—"}
            />
            <Kpi label="ROAS" value={fmtRoas(t?.roas)} />
          </div>

          <section className="overflow-hidden rounded-2xl border border-line bg-white">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                {drillWeek ? (
                  <button
                    type="button"
                    onClick={() => setDrillWeekKey(null)}
                    className="rounded border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-wash"
                  >
                    ← Weken
                  </button>
                ) : null}
                <p className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
                  <MetaMark className="h-3.5 w-5" />
                  {chartTitle}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-3 bg-[#A8D5B5]" />
                  Spend
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-3 bg-[#0a4727]" />
                  Leads
                </span>
                {drillWeek ? (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-[#0a4727]" />
                      Cum. leads
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-4 bg-[#C45A12]" />
                      Schema (doel)
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-4 bg-[#C45A12]" />
                    Leads nodig
                  </span>
                )}
              </div>
            </header>
            <div className="px-1 py-3 sm:px-2">
              <TrendChart
                buckets={chartBuckets}
                compareLabel={compareLabel}
                paceMode={Boolean(drillWeek)}
                onBucketClick={
                  mode === "weeks" && !drillWeek
                    ? (bk) => setDrillWeekKey(bk.key)
                    : undefined
                }
              />
              {mode === "weeks" && !drillWeek ? (
                <p className="px-3 pb-1 text-center text-[10px] text-muted">
                  Klik op een week voor de dagen
                </p>
              ) : null}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-line bg-white">
            <header className="border-b border-line px-4 py-3.5 sm:px-5">
              <p className="flex items-center gap-1.5 font-display text-base font-semibold text-ink">
                <MetaMark className="h-3.5 w-5" />
                Campagnes
              </p>
            </header>
            <div className="overflow-x-auto p-3 sm:p-4">
              {data.months.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  Geen data in deze periode.
                </p>
              ) : (
                <table className="w-full min-w-[960px] border-collapse border border-line text-[12px]">
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
                                      ? wk.campaigns.length === 0
                                        ? (
                                            <tr>
                                              <td
                                                className={`${sheetCell} pl-10 text-left text-muted`}
                                                colSpan={11}
                                              >
                                                Geen campagnes
                                              </td>
                                            </tr>
                                          )
                                        : wk.campaigns.map((c) => {
                                            const meta =
                                              isMetaCampaign(
                                                c.label,
                                                metaNormKeys
                                              ) || c.spend > 0;
                                            return (
                                              <tr
                                                key={`${wk.weekKey}-${c.key}`}
                                                className="hover:bg-[#FAFBFA]"
                                              >
                                                <td
                                                  className={`${sheetCell} sticky left-0 z-[1] max-w-[18rem] bg-white pl-10 text-left font-medium`}
                                                >
                                                  <span className="flex items-center gap-1.5">
                                                    {meta ? (
                                                      <MetaMark className="h-3 w-[18px] shrink-0" />
                                                    ) : null}
                                                    <span
                                                      className="truncate"
                                                      title={c.label}
                                                    >
                                                      {c.label}
                                                    </span>
                                                  </span>
                                                </td>
                                                <MetricsCells m={c} />
                                              </tr>
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

          {data.lastSyncAt ? (
            <p className="text-[11px] text-muted">
              Laatste Meta-sync:{" "}
              {new Date(data.lastSyncAt).toLocaleString("nl-NL")}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

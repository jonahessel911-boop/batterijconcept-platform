"use client";

import { useId } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import { formatEuro } from "@/lib/format";
import type { MarketingMetrics } from "@/lib/marketing-rapportage";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";

type ChartBucket = MarketingMetrics & {
  key: string;
  label: string;
  shortLabel: string;
  cumLeads?: number;
  cumLeadsNodig?: number;
};

type ChartRow = ChartBucket & {
  index: number;
  need: number | null;
  cum: number | null;
};

const chartConfig = {
  spend: { label: "Spend", color: "#8FCBAA" },
  leads: { label: "Leads", color: "#0a4727" },
  need: { label: "Leads nodig", color: "#C45A12" },
  cum: { label: "Cum. leads", color: "#0a4727" },
} satisfies ChartConfig;

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
  return `${sign}${n.toLocaleString("nl-NL", { maximumFractionDigits: 0 })}%`;
}

function deltaTone(n: number | null): string {
  if (n == null || n === 0) return "text-muted";
  return n > 0 ? "text-green-dark" : "text-[#C45A12]";
}

function num(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL");
}

function fmtRoas(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toLocaleString("nl-NL", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}x`;
}

function DeltaTick({
  x = 0,
  y = 0,
  payload,
  index = 0,
  rows,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
  index?: number;
  rows: ChartRow[];
}) {
  const row = rows[index];
  const prev = index > 0 ? rows[index - 1] : null;
  const d = pctChange(row?.leads, prev?.leads);
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        textAnchor="middle"
        fill="#5a635c"
        fontSize={11}
        fontWeight={600}
      >
        {payload?.value}
      </text>
      {d != null ? (
        <text
          y={14}
          textAnchor="middle"
          fill={d > 0 ? "#0d5c32" : d < 0 ? "#C45A12" : "#5a635c"}
          fontSize={10}
          fontWeight={700}
        >
          {fmtPctDelta(d)}
        </text>
      ) : null}
    </g>
  );
}

function Tip({
  active,
  payload,
  rows,
  compareLabel,
  paceMode,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
  rows: ChartRow[];
  compareLabel: string;
  paceMode: boolean;
}) {
  if (!active || !payload?.length) return null;
  const tip = payload[0]?.payload;
  if (!tip) return null;
  const prev = tip.index > 0 ? rows[tip.index - 1] : null;
  const deltas = {
    spend: pctChange(tip.spend, prev?.spend),
    leads: pctChange(tip.leads, prev?.leads),
    afspraken: pctChange(tip.afspraken, prev?.afspraken),
    cpl: pctChange(tip.cpl, prev?.cpl),
    cpa: pctChange(tip.cpa, prev?.cpa),
    cac: pctChange(tip.cac, prev?.cac),
    omzet: pctChange(tip.omzet, prev?.omzet),
    roas: pctChange(tip.roas, prev?.roas),
  };
  const tipRows: {
    label: string;
    huidig: string;
    doel: string | null;
    delta: number | null;
  }[] = [
    {
      label: "Spend",
      huidig: formatEuro(tip.spend),
      doel: null,
      delta: deltas.spend,
    },
    {
      label: "Leads",
      huidig: num(tip.leads),
      doel: tip.leadsNodig != null ? num(tip.leadsNodig) : null,
      delta: deltas.leads,
    },
    {
      label: "Afspr.",
      huidig: num(tip.afspraken),
      doel: null,
      delta: deltas.afspraken,
    },
    {
      label: "CPL",
      huidig: tip.cpl != null ? formatEuro(tip.cpl) : "—",
      doel: null,
      delta: deltas.cpl,
    },
    {
      label: "CPA",
      huidig: tip.cpa != null ? formatEuro(tip.cpa) : "—",
      doel: null,
      delta: deltas.cpa,
    },
    {
      label: "CPD",
      huidig: tip.cac != null ? formatEuro(tip.cac) : "—",
      doel: null,
      delta: deltas.cac,
    },
    {
      label: "Omzet",
      huidig: formatEuro(tip.omzet),
      doel: null,
      delta: deltas.omzet,
    },
    {
      label: "ROAS",
      huidig: fmtRoas(tip.roas),
      doel: null,
      delta: deltas.roas,
    },
  ];
  const showDoel = tipRows.some((r) => r.doel != null);

  return (
    <div className="min-w-[12.5rem] rounded-lg border border-line bg-white px-2.5 py-2 text-[11px] shadow-md">
      <p className="mb-1.5 truncate font-semibold text-ink">{tip.label}</p>
      <table className="w-full border-collapse tabular-nums">
        <tbody>
          {tipRows.map((row) => (
            <tr key={row.label}>
              <td className="py-0.5 pr-2 text-left text-muted">{row.label}</td>
              <td className="py-0.5 text-right font-semibold text-ink">
                {row.huidig}
              </td>
              {showDoel ? (
                <td
                  className={`py-0.5 pl-2 text-right font-semibold ${
                    row.doel != null ? "text-green-dark" : "text-muted/40"
                  }`}
                >
                  {row.doel ?? "—"}
                </td>
              ) : null}
              {prev ? (
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
          <span className="font-semibold text-ink">{num(tip.cumLeads)}</span>
          {" / "}
          <span className="font-semibold text-[#C45A12]">
            {num(tip.cumLeadsNodig)}
          </span>
        </p>
      ) : null}
      {prev ? (
        <p className="mt-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted">
          Δ vs {compareLabel}
        </p>
      ) : null}
    </div>
  );
}

export function MarketingTrendChart({
  buckets,
  compareLabel,
  onBucketClick,
  paceMode = false,
}: {
  buckets: ChartBucket[];
  compareLabel: string;
  onBucketClick?: (bucket: ChartBucket) => void;
  paceMode?: boolean;
}) {
  const gradId = useId().replace(/:/g, "");
  const rows: ChartRow[] = buckets.map((b, index) => ({
    ...b,
    index,
    need: paceMode ? (b.cumLeadsNodig ?? null) : (b.leadsNodig ?? null),
    cum: paceMode ? (b.cumLeads ?? 0) : null,
  }));

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Geen data.</p>;
  }

  return (
    <ChartContainer
      config={chartConfig}
      className={`aspect-auto h-56 w-full sm:h-64 lg:h-72 ${
        onBucketClick ? "cursor-pointer" : ""
      }`}
    >
      <ComposedChart
        data={rows}
        margin={{ top: 16, right: 28, left: 28, bottom: 8 }}
        onClick={(state) => {
          const index = state?.activeTooltipIndex;
          if (typeof index === "number" && rows[index]) {
            onBucketClick?.(rows[index]);
          }
        }}
      >
        <defs>
          <linearGradient id={`${gradId}-spend`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8FCBAA" stopOpacity={0.85} />
            <stop offset="95%" stopColor="#8FCBAA" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id={`${gradId}-leads`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#0a4727" stopOpacity={0.28} />
            <stop offset="95%" stopColor="#0a4727" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#e2e8e4" strokeDasharray="3 3" />
        <XAxis
          dataKey="shortLabel"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={0}
          padding={{ left: 8, right: 8 }}
          height={40}
          tick={(props) => (
            <DeltaTick
              x={typeof props.x === "number" ? props.x : undefined}
              y={typeof props.y === "number" ? props.y : undefined}
              payload={
                props.payload && typeof props.payload.value === "string"
                  ? { value: props.payload.value }
                  : undefined
              }
              index={props.index}
              rows={rows}
            />
          )}
        />
        <YAxis yAxisId="spend" hide domain={[0, "auto"]} />
        <YAxis yAxisId="leads" hide orientation="right" domain={[0, "auto"]} />
        <ChartTooltip
          cursor={{ stroke: "#d0d9d3", strokeWidth: 1 }}
          content={
            <Tip
              rows={rows}
              compareLabel={compareLabel}
              paceMode={paceMode}
            />
          }
        />
        <Area
          yAxisId="spend"
          type="monotone"
          dataKey="spend"
          stroke="#6aab86"
          strokeWidth={1.5}
          fill={`url(#${gradId}-spend)`}
          dot={false}
          activeDot={{ r: 3, fill: "#6aab86", stroke: "#fff", strokeWidth: 1 }}
        />
        <Area
          yAxisId="leads"
          type="monotone"
          dataKey="leads"
          stroke="#0a4727"
          strokeWidth={2}
          fill={`url(#${gradId}-leads)`}
          dot={false}
          activeDot={{ r: 3.5, fill: "#0a4727", stroke: "#fff", strokeWidth: 1 }}
        />
        {paceMode ? (
          <Line
            yAxisId="leads"
            type="monotone"
            dataKey="cum"
            stroke="#0a4727"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            connectNulls
          />
        ) : null}
        <Line
          yAxisId="leads"
          type="monotone"
          dataKey="need"
          stroke="#C45A12"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ChartContainer>
  );
}

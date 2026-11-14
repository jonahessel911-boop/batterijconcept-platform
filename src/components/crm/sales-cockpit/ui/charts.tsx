"use client";

import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const GRID = "#f4f4f5";
const AXIS = "#a1a1aa";

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  /** Optionele tweede as (voor € naast aantallen). */
  yAxisId?: "left" | "right";
};

export type ChartRow = Record<string, string | number>;

type TipItem = {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: ChartRow;
};

function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
}: {
  active?: boolean;
  payload?: readonly TipItem[];
  label?: string | number;
  formatValue?: (value: number, key: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-44 rounded-xl border border-zinc-200 bg-white/95 px-3.5 py-3 shadow-xl backdrop-blur">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">{label}</p>
      <div className="space-y-1.5">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name ?? "");
          const value = Number(item.value ?? 0);
          return (
            <div key={key} className="flex items-center justify-between gap-8 text-xs">
              <span className="inline-flex items-center gap-2 text-zinc-600">
                <span className="size-2.5 rounded-full" style={{ background: item.color }} />
                {item.name}
              </span>
              <span className="font-semibold tabular-nums text-zinc-950">
                {formatValue ? formatValue(value, key) : value.toLocaleString("nl-NL")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChartLegend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      {series.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-2 text-xs text-zinc-500">
          <span className="size-2.5 rounded-full" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

const axisProps = {
  tick: { fill: AXIS, fontSize: 11 },
  axisLine: false,
  tickLine: false,
} as const;

function ChartFrame({
  series,
  empty,
  children,
}: {
  series: ChartSeries[];
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      {series.length > 0 ? <ChartLegend series={series} /> : null}
      <div className="min-h-0 flex-1">
        {empty ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 text-sm text-zinc-500">
            Geen data in deze periode
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export function BarCompareChart({
  data,
  xKey,
  series,
  formatValue,
}: {
  data: ChartRow[];
  xKey: string;
  series: ChartSeries[];
  formatValue?: (value: number, key: string) => string;
}) {
  return (
    <ChartFrame series={series} empty={data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={6} barCategoryGap="28%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey={xKey} {...axisProps} />
          <YAxis {...axisProps} width={28} allowDecimals={false} />
          <Tooltip
            content={(props) => (
              <ChartTooltip
                active={props.active}
                payload={props.payload as unknown as readonly TipItem[] | undefined}
                label={props.label}
                formatValue={formatValue}
              />
            )}
            cursor={{ fill: "rgba(24, 24, 27, 0.04)", radius: 6 }}
          />
          {series.map((item) => (
            <Bar key={item.key} dataKey={item.key} name={item.label} fill={item.color} maxBarSize={22} radius={[6, 6, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function DualAreaChart({
  data,
  xKey,
  series,
  formatValue,
  formatAxis,
  formatAxisRight,
  allowDecimals = false,
  yWidth = 28,
  yWidthRight = 48,
}: {
  data: ChartRow[];
  xKey: string;
  series: ChartSeries[];
  formatValue?: (value: number, key: string) => string;
  formatAxis?: (value: number) => string;
  formatAxisRight?: (value: number) => string;
  allowDecimals?: boolean;
  yWidth?: number;
  yWidthRight?: number;
}) {
  const dualAxis = series.some((s) => s.yAxisId === "right");
  return (
    <ChartFrame series={series} empty={data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {series.map((item) => (
              <linearGradient key={item.key} id={`area-${item.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={item.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={item.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey={xKey} {...axisProps} />
          {dualAxis ? (
            <>
              <YAxis
                yAxisId="left"
                {...axisProps}
                width={yWidth}
                allowDecimals={allowDecimals}
                tickFormatter={formatAxis}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                {...axisProps}
                width={yWidthRight}
                allowDecimals
                tickFormatter={formatAxisRight || formatAxis}
              />
            </>
          ) : (
            <YAxis
              {...axisProps}
              width={yWidth}
              allowDecimals={allowDecimals}
              tickFormatter={formatAxis}
            />
          )}
          <Tooltip
            content={(props) => (
              <ChartTooltip
                active={props.active}
                payload={props.payload as unknown as readonly TipItem[] | undefined}
                label={props.label}
                formatValue={formatValue}
              />
            )}
          />
          {series.map((item) => (
            <Area
              key={item.key}
              yAxisId={dualAxis ? item.yAxisId || "left" : undefined}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              fill={`url(#area-${item.key})`}
              strokeWidth={2.25}
              activeDot={{ r: 4, strokeWidth: 0, fill: item.color }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function AreaTrendChart({
  data,
  xKey,
  seriesKey,
  label,
  color = "#059669",
  formatValue,
  formatAxis,
  allowDecimals = false,
  yWidth,
}: {
  data: ChartRow[];
  xKey: string;
  seriesKey: string;
  label: string;
  color?: string;
  formatValue?: (value: number, key: string) => string;
  formatAxis?: (value: number) => string;
  allowDecimals?: boolean;
  yWidth?: number;
}) {
  return (
    <DualAreaChart
      data={data}
      xKey={xKey}
      series={[{ key: seriesKey, label, color }]}
      formatValue={formatValue}
      formatAxis={formatAxis}
      allowDecimals={allowDecimals}
      yWidth={yWidth}
    />
  );
}

export function HorizontalBarChart({
  data,
  labelKey = "label",
  valueKey = "value",
  color = "#18181b",
  formatValue,
  reference,
}: {
  data: ChartRow[];
  labelKey?: string;
  valueKey?: string;
  color?: string | ((row: ChartRow) => string);
  formatValue?: (value: number, key: string) => string;
  reference?: number;
}) {
  const max = Math.max(1, ...data.map((row) => Number(row[valueKey] || 0)), reference || 0);
  return (
    <ChartFrame series={[]} empty={data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" domain={[0, Math.ceil(max * 1.05)]} {...axisProps} />
          <YAxis type="category" dataKey={labelKey} width={108} {...axisProps} />
          <Tooltip
            content={(props) => (
              <ChartTooltip
                active={props.active}
                payload={props.payload as unknown as readonly TipItem[] | undefined}
                label={props.label}
                formatValue={formatValue}
              />
            )}
            cursor={{ fill: "rgba(24, 24, 27, 0.04)" }}
          />
          <Bar dataKey={valueKey} name="Aantal" radius={[0, 6, 6, 0]} maxBarSize={18}>
            {data.map((row, index) => (
              <Cell
                key={index}
                fill={typeof color === "function" ? color(row) : color}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function StackedBarChart({
  data,
  xKey,
  series,
  formatValue,
  stackOffset,
}: {
  data: ChartRow[];
  xKey: string;
  series: ChartSeries[];
  formatValue?: (value: number, key: string) => string;
  stackOffset?: "expand";
}) {
  return (
    <ChartFrame series={series} empty={data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} stackOffset={stackOffset} barCategoryGap="28%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey={xKey} {...axisProps} />
          <YAxis
            {...axisProps}
            width={36}
            allowDecimals={false}
            tickFormatter={
              stackOffset === "expand"
                ? (value: number) => `${Math.round(value * 100)}%`
                : undefined
            }
          />
          <Tooltip
            content={(props) => (
              <ChartTooltip
                active={props.active}
                payload={props.payload as unknown as readonly TipItem[] | undefined}
                label={props.label}
                formatValue={formatValue}
              />
            )}
            cursor={{ fill: "rgba(24, 24, 27, 0.04)" }}
          />
          {series.map((item) => (
            <Bar key={item.key} dataKey={item.key} name={item.label} stackId="a" fill={item.color} maxBarSize={28} radius={[0, 0, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Horizontale stacked bars (shadcn-stijl) — goed voor samenstelling per categorie. */
export function HorizontalStackedBarChart({
  data,
  labelKey = "label",
  series,
  formatValue,
  stackOffset,
  labelWidth = 72,
}: {
  data: ChartRow[];
  labelKey?: string;
  series: ChartSeries[];
  formatValue?: (value: number, key: string) => string;
  stackOffset?: "expand";
  labelWidth?: number;
}) {
  const lastKey = series[series.length - 1]?.key;
  return (
    <ChartFrame series={series} empty={data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          stackOffset={stackOffset}
          barCategoryGap="28%"
          margin={{ top: 4, right: 12, left: 0, bottom: 4 }}
        >
          <CartesianGrid stroke={GRID} strokeDasharray="4 4" horizontal={false} />
          <XAxis
            type="number"
            {...axisProps}
            tickFormatter={
              stackOffset === "expand"
                ? (value: number) => `${Math.round(value * 100)}%`
                : undefined
            }
            domain={stackOffset === "expand" ? [0, 1] : undefined}
          />
          <YAxis
            type="category"
            dataKey={labelKey}
            width={labelWidth}
            {...axisProps}
          />
          <Tooltip
            content={(props) => (
              <ChartTooltip
                active={props.active}
                payload={props.payload as unknown as readonly TipItem[] | undefined}
                label={props.label}
                formatValue={formatValue}
              />
            )}
            cursor={{ fill: "rgba(24, 24, 27, 0.04)" }}
          />
          {series.map((item, index) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.label}
              stackId="a"
              fill={item.color}
              maxBarSize={22}
              radius={
                index === 0
                  ? [4, 0, 0, 4]
                  : item.key === lastKey
                    ? [0, 4, 4, 0]
                    : [0, 0, 0, 0]
              }
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

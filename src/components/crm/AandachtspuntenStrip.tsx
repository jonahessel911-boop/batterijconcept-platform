"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AandachtBar,
  AandachtspuntenResult,
} from "@/lib/aandachtspunten";

type Props = {
  rangeMode: "weeks" | "month";
  rangeWeekKey: string;
  rangeMonthYm: string;
};

function pct(actual: number, target: number): number {
  if (target <= 0) return actual > 0 ? 100 : 0;
  return Math.min(100, Math.round((actual / target) * 100));
}

function TargetBar({ bar }: { bar: AandachtBar }) {
  const fill = pct(bar.actual, bar.target);
  const ok = bar.actual >= bar.target;

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted">
            {bar.unitLabel}
          </p>
          <p className="truncate font-display text-sm font-semibold text-ink">
            {bar.label}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-ink">
            {bar.actual.toLocaleString("nl-NL")}
            <span className="font-normal text-muted">
              {" "}
              / {bar.target.toLocaleString("nl-NL")}
            </span>
          </p>
          <p
            className={[
              "text-[10px] font-semibold uppercase tracking-wide",
              ok ? "text-green-dark" : "text-[#C45A12]",
            ].join(" ")}
          >
            {ok ? "Doel gehaald" : "Nog niet"}
          </p>
        </div>
      </div>

      <div className="relative mt-2 h-3 w-full bg-[#E8ECEA]">
        <div
          className={[
            "absolute inset-y-0 left-0 transition-all",
            ok ? "bg-[#0a4727]" : "bg-[#C45A12]",
          ].join(" ")}
          style={{ width: `${fill}%` }}
        />
      </div>
    </div>
  );
}

export function AandachtspuntenStrip({
  rangeMode,
  rangeWeekKey,
  rangeMonthYm,
}: Props) {
  const [data, setData] = useState<AandachtspuntenResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const mode = rangeMode === "month" ? "month" : "week";
      const qs = new URLSearchParams({ mode });
      if (mode === "month") qs.set("month", rangeMonthYm);
      else qs.set("week", rangeWeekKey);

      const res = await fetch(`/api/rapportage/aandachtspunten?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData(json as AandachtspuntenResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [rangeMode, rangeWeekKey, rangeMonthYm]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="border border-line bg-white px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-display text-base font-semibold text-ink">
            Aandachtspunten
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Huidig / doel · afspraken = open slots
            {data?.periodLabel ? ` · ${data.periodLabel}` : ""}
          </p>
        </div>
        {loading ? (
          <p className="text-xs text-muted">Laden…</p>
        ) : error ? (
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs font-semibold text-[#C45A12] underline"
          >
            {error} — opnieuw
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-5 sm:grid-cols-3 sm:gap-6">
        {(data?.bars ?? [
          {
            id: "leads" as const,
            label: "Leads",
            unitLabel: "Leads",
            actual: 0,
            target: 0,
            paceTarget: 0,
            onTrack: true,
          },
          {
            id: "afspraken" as const,
            label: "Geplande afspraken",
            unitLabel: "Bellen / planning",
            actual: 0,
            target: 0,
            paceTarget: 0,
            onTrack: true,
          },
          {
            id: "sales" as const,
            label: "Sales",
            unitLabel: "Sales",
            actual: 0,
            target: 0,
            paceTarget: 0,
            onTrack: true,
          },
        ]).map((bar) => (
          <TargetBar key={bar.id} bar={bar} />
        ))}
      </div>
    </section>
  );
}

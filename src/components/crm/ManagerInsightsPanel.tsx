"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  InsightSeverity,
  ManagerInsight,
  ManagerInsightsResult,
} from "@/lib/manager-insights";

function severityStyles(s: InsightSeverity): string {
  switch (s) {
    case "kritiek":
      return "border-[#C45A12]/40 bg-[#FFF0E6]";
    case "aandacht":
      return "border-[#C9A227]/40 bg-[#FFF8E6]";
    case "ok":
      return "border-[#0a4727]/25 bg-[#EEF3F0]";
    default:
      return "border-line bg-white";
  }
}

function severityLabel(s: InsightSeverity): string {
  switch (s) {
    case "kritiek":
      return "Kritiek";
    case "aandacht":
      return "Aandacht";
    case "ok":
      return "Op schema";
    default:
      return "Info";
  }
}

function InsightCard({ insight }: { insight: ManagerInsight }) {
  return (
    <article
      className={`rounded-xl border px-4 py-3 ${severityStyles(insight.severity)}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-display text-sm font-semibold text-ink">
          {insight.title}
        </p>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted">
          {severityLabel(insight.severity)}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink/90">{insight.detail}</p>
      {insight.diagnose ? (
        <p className="mt-2 border-t border-line/60 pt-2 text-[12px] text-muted">
          <span className="font-semibold text-ink">Diagnose: </span>
          {insight.diagnose}
        </p>
      ) : null}
      {insight.metrics && insight.metrics.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-3">
          {insight.metrics.map((m) => (
            <div key={m.label} className="text-[11px]">
              <span className="text-muted">{m.label}: </span>
              <span className="font-semibold tabular-nums text-ink">
                {m.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function ManagerInsightsPanel() {
  const [data, setData] = useState<ManagerInsightsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rapportage/manager-insights", {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Laden mislukt"
        );
      }
      setData(json as ManagerInsightsResult);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs text-muted">
          {data?.periodLabel || (loading ? "Laden…" : "")}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
        >
          {loading ? "Laden…" : "Vernieuwen"}
        </button>
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
        <p className="text-sm text-muted">Insights laden…</p>
      ) : data ? (
        <div className="space-y-8">
          {data.units.map((unit) => (
            <section key={unit.id} className="space-y-3">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
                <p className="font-display text-base font-semibold text-ink">
                  {unit.label}
                </p>
                <p className="text-xs text-muted">{unit.summary}</p>
              </header>
              <div className="grid gap-3 lg:grid-cols-2">
                {unit.insights.map((insight) => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

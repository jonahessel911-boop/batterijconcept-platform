"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CeoUnitBar,
  CeoUnitPeriod,
  CeoUnitTargetsResult,
} from "@/lib/ceo-unit-targets";

function UnitBar({ bar }: { bar: CeoUnitBar }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-sm font-semibold text-ink">{bar.label}</p>
        <div className="flex shrink-0 items-baseline gap-2">
          <p className="text-sm font-semibold tabular-nums text-ink">
            {bar.detail}
          </p>
          <p
            className={[
              "text-[11px] font-semibold",
              bar.onTrack ? "text-green-dark" : "text-[#C45A12]",
            ].join(" ")}
          >
            {bar.onTrack ? "Op doel" : "Achter"}
          </p>
        </div>
      </div>
      <div className="mt-2 h-2.5 w-full bg-[#E8ECEA]">
        <div
          className={[
            "h-full transition-all",
            bar.onTrack ? "bg-[#0a4727]" : "bg-[#C45A12]",
          ].join(" ")}
          style={{ width: `${bar.barPct}%` }}
        />
      </div>
    </div>
  );
}

const PERIODS: { id: CeoUnitPeriod; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "biweekly", label: "2 weken" },
  { id: "month", label: "Maand" },
  { id: "quarter", label: "Kwartaal" },
  { id: "year", label: "Jaar" },
  { id: "all", label: "Alles" },
];

export function CeoUnitTargetsPanel() {
  const [period, setPeriod] = useState<CeoUnitPeriod>("week");
  const [data, setData] = useState<CeoUnitTargetsResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: CeoUnitPeriod) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/rapportage/ceo-unit-targets?period=${p}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData(json as CeoUnitTargetsResult);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-base font-semibold text-ink">Units</p>
        <div className="flex flex-wrap gap-1 border border-line p-0.5">
          {PERIODS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPeriod(id)}
              className={[
                "px-2.5 py-1.5 text-xs font-semibold transition",
                period === id
                  ? "bg-[#0a4727] text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <p className="text-sm text-muted">Laden…</p>
      ) : !data ? (
        <p className="text-sm text-muted">Geen data</p>
      ) : (
        <div className="space-y-4 border border-line bg-white px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {data.periodLabel}
          </p>
          {data.bars.map((bar) => (
            <UnitBar key={bar.id} bar={bar} />
          ))}
        </div>
      )}
    </section>
  );
}

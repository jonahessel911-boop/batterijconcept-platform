"use client";

import { useMemo, useState } from "react";
import { AandachtspuntenStrip } from "./AandachtspuntenStrip";
import { MarketingPanel } from "./MarketingPanel";
import { SalesDashboardPanel } from "./SalesDashboardPanel";
import { BelDashboardPanel } from "./BelDashboardPanel";
import { ProjectedPnlPanel } from "./ProjectedPnlPanel";
import { CurrentPnlPanel } from "./CurrentPnlPanel";
import { CeoUnitTargetsPanel } from "./CeoUnitTargetsPanel";
import {
  agendaWeekJumpOptions,
  formatSchouwWeekLabel,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekValue,
} from "@/lib/schouw-week";
import { todayConversieYmd } from "@/lib/conversie-period";

export type CeoRangeMode = "weeks" | "month";

/**
 * CEO / Totaal: Marketing · Sales · Callcenter · Projected/Current P&L.
 * Één gedeelde Week/Maand-kiezer past alle grafieken tegelijk aan.
 */
export function CeoTotaalPanel() {
  const today = todayConversieYmd();
  const [mode, setMode] = useState<CeoRangeMode>("weeks");
  const [weekKey, setWeekKey] = useState(() => {
    const w = schouwWeekFromDate(new Date(`${today}T12:00:00`));
    return schouwWeekValue(w.jaar, w.week);
  });
  const [monthYm, setMonthYm] = useState(today.slice(0, 7));

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

  const range = { mode, weekKey, monthYm };

  return (
    <div className="bg-wash/40">
      <div className="sticky top-0 z-30 flex flex-wrap items-end justify-between gap-3 border-b border-line bg-white/95 px-4 py-3 backdrop-blur-sm sm:px-5">
        <div>
          <p className="font-display text-base font-semibold text-ink">Totaal</p>
          <p className="mt-0.5 text-xs text-muted">
            Kies hieronder de periode — alle blokken (Marketing · Sales ·
            Callcenter · Projected/Current P&L) tonen data t/m die week of
            maand.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-1 border border-line p-0.5">
            {(
              [
                ["weeks", "Per week"],
                ["month", "Per maand"],
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
              Eindmaand
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
      </div>

      <div className="space-y-10 px-4 py-5 sm:px-5 sm:py-6">
        <AandachtspuntenStrip
          rangeMode={range.mode}
          rangeWeekKey={range.weekKey}
          rangeMonthYm={range.monthYm}
        />
        <section className="space-y-3">
          <MarketingPanel
            rangeMode={range.mode}
            rangeWeekKey={range.weekKey}
            rangeMonthYm={range.monthYm}
            hideRangeControls
          />
        </section>
        <hr className="border-line" />
        <section className="space-y-3">
          <SalesDashboardPanel
            rangeMode={range.mode}
            rangeWeekKey={range.weekKey}
            rangeMonthYm={range.monthYm}
            hideRangeControls
          />
        </section>
        <hr className="border-line" />
        <section className="space-y-3">
          <BelDashboardPanel
            rangeMode={range.mode}
            rangeWeekKey={range.weekKey}
            rangeMonthYm={range.monthYm}
            hideRangeControls
          />
        </section>
        <hr className="border-line" />
        <section className="space-y-3">
          <ProjectedPnlPanel
            rangeMode={range.mode}
            rangeWeekKey={range.weekKey}
            rangeMonthYm={range.monthYm}
            hideRangeControls
          />
        </section>
        <hr className="border-line" />
        <section className="space-y-3">
          <CurrentPnlPanel
            rangeMode={range.mode}
            rangeWeekKey={range.weekKey}
            rangeMonthYm={range.monthYm}
            hideRangeControls
          />
        </section>
        <hr className="border-line" />
        <CeoUnitTargetsPanel />
      </div>
    </div>
  );
}

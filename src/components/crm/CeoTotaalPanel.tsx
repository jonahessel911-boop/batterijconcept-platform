"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEuro } from "@/lib/format";
import {
  PERIOD_PRESET_LABELS,
  type ManagementDashboardData,
  type MgmtPeriodPreset,
} from "@/lib/management-dashboard";

const CEO_PERIODS: MgmtPeriodPreset[] = [
  "today",
  "this_week",
  "last_7_days",
  "this_month",
  "last_30_days",
  "this_quarter",
  "this_year",
];

function num(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${num(n, 1)}%`;
}

export function CeoTotaalPanel() {
  const [period, setPeriod] = useState<MgmtPeriodPreset>("this_month");
  const [data, setData] = useState<ManagementDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: MgmtPeriodPreset) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/management-dashboard?period=${encodeURIComponent(p)}`
      );
      const json = (await res.json()) as ManagementDashboardData & {
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [period, load]);

  if (loading && !data) {
    return <p className="px-4 py-10 text-center text-sm text-muted">Laden…</p>;
  }

  if (error && !data) {
    return (
      <p className="m-4 rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
        {error}{" "}
        <button
          type="button"
          onClick={() => void load(period)}
          className="font-semibold underline"
        >
          Opnieuw
        </button>
      </p>
    );
  }

  if (!data?.finance?.ceo) return null;
  const ceo = data.finance.ceo;
  const periodLabel = data.period?.label || PERIOD_PRESET_LABELS[period];

  return (
    <div className="space-y-5 px-4 py-5 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold text-ink">
            Totaal · CEO
          </p>
          <p className="mt-0.5 max-w-2xl text-xs text-muted">
            Eén overzicht: volume, omzet, kosten en winst · {periodLabel}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 border border-line p-0.5">
          {CEO_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={[
                "px-2.5 py-1.5 text-xs font-semibold transition",
                period === p
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              {PERIOD_PRESET_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {/* Volume */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Leads" value={num(ceo.leads)} hint="Binnen in periode" />
        <StatCard
          label="Afspraken"
          value={num(ceo.afsprakenNetto)}
          hint="Netto huisbezoeken gezet"
        />
        <StatCard
          label="Deals"
          value={num(ceo.deals)}
          hint="Getekende offertes"
        />
        <StatCard
          label="Gem. order"
          value={
            ceo.avgOrderWorth != null ? formatEuro(ceo.avgOrderWorth) : "—"
          }
          hint="Order worth / deals"
        />
      </div>

      {/* Money heroes */}
      <div className="grid gap-3 sm:grid-cols-3">
        <HeroCard
          label="Order worth"
          value={formatEuro(ceo.orderWorth)}
          sub="Getekende omzet excl. btw"
          tone="ink"
        />
        <HeroCard
          label="Revenue paid"
          value={formatEuro(ceo.revenuePaid)}
          sub={`Gefactureerd ${formatEuro(ceo.revenueInvoiced)}`}
          tone="ink"
        />
        <HeroCard
          label="Profit"
          value={formatEuro(ceo.profit)}
          sub={`Marge ${pct(ceo.profitMarginPct)}`}
          tone={ceo.profit >= 0 ? "green" : "red"}
        />
      </div>

      {/* P&L */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Winstberekening · excl. btw
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Order worth − product − installatie − sales commissie − lead cost
            (ads)
          </p>
        </div>
        <div className="divide-y divide-line">
          <PnlRow
            label="Order worth (getekend)"
            value={formatEuro(ceo.orderWorth)}
            strong
          />
          <PnlRow
            label="− Product / inkoop"
            value={formatEuro(ceo.costs.product)}
            muted
          />
          <PnlRow
            label="− Installatie"
            value={formatEuro(ceo.costs.installation)}
            muted
          />
          <PnlRow
            label="− Sales commissie"
            value={formatEuro(ceo.costs.salesCommission)}
            muted
          />
          <PnlRow
            label="− Lead cost (ads)"
            value={formatEuro(ceo.costs.leadAds)}
            muted
          />
          <PnlRow
            label="= Totale kosten"
            value={formatEuro(ceo.costs.total)}
          />
          <PnlRow
            label="Profit"
            value={formatEuro(ceo.profit)}
            strong
            emphasize={ceo.profit >= 0 ? "green" : "red"}
          />
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        Definities: leads = binnenkomst in periode · afspraken = netto fysieke
        huisbezoeken gezet · deals / order worth = ondertekende offertes op
        ondertekendatum · paid = betaalde facturen op betaaldatum · profit =
        getekende omzet − inkoop − standaard/project-installatie −
        adviseurcommissie − Meta/ad spend. Geen cash-realized P&amp;L — verwachte
        bruto op getekende deals.
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-muted">{hint}</p>
    </div>
  );
}

function HeroCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "ink" | "green" | "red";
}) {
  const valueClass =
    tone === "green"
      ? "text-green-dark"
      : tone === "red"
        ? "text-[#C62828]"
        : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        {label}
      </p>
      <p
        className={`mt-2 font-display text-3xl font-semibold tabular-nums sm:text-4xl ${valueClass}`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-xs text-muted">{sub}</p>
    </div>
  );
}

function PnlRow({
  label,
  value,
  strong,
  muted,
  emphasize,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  emphasize?: "green" | "red";
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <span
        className={[
          strong ? "font-semibold text-ink" : "text-ink",
          muted ? "text-muted" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {label}
      </span>
      <span
        className={[
          "tabular-nums",
          strong ? "font-semibold" : "",
          emphasize === "green"
            ? "text-green-dark"
            : emphasize === "red"
              ? "text-[#C62828]"
              : muted
                ? "text-muted"
                : "text-ink",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

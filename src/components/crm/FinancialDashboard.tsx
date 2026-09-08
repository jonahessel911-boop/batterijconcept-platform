"use client";

import { useState } from "react";
import type {
  FinancialDashboardData,
  FinancialDateRange,
  FreeCashflowSnapshot,
  FreeCashflowWeekRow,
} from "@/lib/financial-dashboard";
import { financialRangeLabel } from "@/lib/financial-dashboard";
import { formatEuro } from "@/lib/format";

const RANGES: FinancialDateRange[] = [
  "this_week",
  "last_7_days",
  "this_month",
  "last_30_days",
  "this_year",
  "all_time",
];

type WeekTab = "inkomsten" | "inkoop" | "installatie" | "overig";

const WEEK_TABS: { id: WeekTab; label: string }[] = [
  { id: "inkomsten", label: "Inkomsten" },
  { id: "inkoop", label: "Inkoop" },
  { id: "installatie", label: "Installatie" },
  { id: "overig", label: "Overig" },
];

function FreeCashflowPanel({ fc }: { fc: FreeCashflowSnapshot }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [tabByWeek, setTabByWeek] = useState<Record<string, WeekTab>>({});

  const totalVerwacht = (fc.weeks || []).reduce(
    (s, w) => s + (Number(w.verwachtBinnen) || 0),
    0
  );
  const totalDaadwerkelijk = (fc.weeks || []).reduce(
    (s, w) => s + (Number(w.daadwerkelijkBinnen) || 0),
    0
  );
  const totalUit = (fc.weeks || []).reduce(
    (s, w) => s + (Number(w.verwachtUit) || 0),
    0
  );
  const eind =
    fc.weeks && fc.weeks.length > 0
      ? fc.weeks[fc.weeks.length - 1].eindstand
      : fc.beginsaldo;
  const vrijeEind =
    fc.weeks && fc.weeks.length > 0
      ? fc.weeks[fc.weeks.length - 1].vrijeCash
      : 0;

  return (
    <section className="border border-line bg-white">
      <div className="grid gap-px border-b border-line bg-line sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <SummaryCell
          label="Beginstand"
          value={formatEuro(fc.beginsaldo)}
          hint={
            fc.beginsaldoOntbreekt
              ? "Nog niet gezet (management-instellingen)"
              : "Cash op bank (instelling)"
          }
        />
        <SummaryCell
          label="Verwacht binnen"
          value={formatEuro(totalVerwacht)}
          hint="Open facturen + nog te factureren rest"
          tone="orange"
        />
        <SummaryCell
          label="Daadwerkelijk binnen"
          value={formatEuro(totalDaadwerkelijk)}
          hint="Betaalde facturen · eerdere betalingen in huidige week als beginsaldo ontbreekt"
          tone="green"
        />
        <SummaryCell
          label="Btw te betalen"
          value={formatEuro(fc.btwTeBetalen ?? fc.afTeDragenBtw ?? 0)}
          hint="Gereserveerd / af te dragen (lock op vrije cash)"
          tone="red"
        />
        <SummaryCell
          label="Verwacht uit"
          value={formatEuro(totalUit)}
          hint="Inkoop + installatie €675 + ads"
          tone="red"
        />
        <SummaryCell
          label="Vrije cash (einde)"
          value={formatEuro(vrijeEind)}
          hint={`Eindstand ${formatEuro(eind)} − btw − open uit`}
          tone="green"
        />
      </div>

      <div className="px-4 py-4 sm:px-5">
        <p className="text-sm font-semibold text-ink">Per week</p>
        <p className="mt-0.5 text-[11px] text-muted">
          Klik een week open voor detailtabs: inkomsten, inkoop, installatie,
          overig.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[10px] font-semibold uppercase tracking-wide text-muted">
                <th className="w-8 px-2 py-2" />
                <th className="px-2 py-2">Week</th>
                <th className="px-2 py-2 text-right">Beginstand</th>
                <th className="px-2 py-2 text-right">Verwacht binnen</th>
                <th className="px-2 py-2 text-right">Daadwerkelijk binnen</th>
                <th className="px-2 py-2 text-right">Verwacht uit</th>
                <th className="px-2 py-2 text-right">Eindstand</th>
                <th className="px-2 py-2 text-right">Vrije cash</th>
              </tr>
            </thead>
            <tbody>
              {(fc.weeks || []).map((w) => {
                const key = `${w.year}-W${w.week}`;
                const open = openKey === key;
                const tab = tabByWeek[key] || "inkomsten";
                return (
                  <WeekRow
                    key={key}
                    week={w}
                    open={open}
                    tab={tab}
                    onToggle={() => setOpenKey(open ? null : key)}
                    onTab={(t) =>
                      setTabByWeek((prev) => ({ ...prev, [key]: t }))
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-muted sm:px-5">
        Open facturen = verwacht · betaalde facturen = daadwerkelijk · rest
        order ~5w · inkoop die week · installatie €675 ~6w · ads onder Overig.
      </p>
    </section>
  );
}

function WeekRow({
  week: w,
  open,
  tab,
  onToggle,
  onTab,
}: {
  week: FreeCashflowWeekRow;
  open: boolean;
  tab: WeekTab;
  onToggle: () => void;
  onTab: (t: WeekTab) => void;
}) {
  const details = w.details || {
    inkomsten: [],
    inkoop: [],
    installatie: [],
    overig: [],
  };

  return (
    <>
      <tr
        className={[
          "border-b border-line cursor-pointer hover:bg-wash/80",
          open ? "bg-wash/60" : "",
        ].join(" ")}
        onClick={onToggle}
      >
        <td className="px-2 py-2.5 text-muted">{open ? "▾" : "▸"}</td>
        <td className="px-2 py-2.5 font-medium text-ink">{w.label}</td>
        <td className="px-2 py-2.5 text-right tabular-nums text-ink">
          {formatEuro(w.beginstand)}
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums text-[#C45A12]">
          {formatEuro(w.verwachtBinnen)}
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums text-green-dark">
          {formatEuro(w.daadwerkelijkBinnen)}
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums text-[#C62828]">
          {formatEuro(w.verwachtUit)}
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums font-semibold text-ink">
          {formatEuro(w.eindstand)}
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums font-semibold text-green-dark">
          {formatEuro(w.vrijeCash)}
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-line bg-wash/40">
          <td colSpan={8} className="px-3 py-3">
            <div
              className="flex gap-1 overflow-x-auto pb-2"
              onClick={(e) => e.stopPropagation()}
            >
              {WEEK_TABS.map((t) => {
                const count =
                  t.id === "inkomsten"
                    ? details.inkomsten.length
                    : t.id === "inkoop"
                      ? details.inkoop.length
                      : t.id === "installatie"
                        ? details.installatie.length
                        : details.overig.length;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onTab(t.id)}
                    className={[
                      "shrink-0 border px-3 py-1.5 text-xs font-semibold",
                      tab === t.id
                        ? "border-green bg-green text-white"
                        : "border-line bg-white text-ink hover:bg-wash",
                    ].join(" ")}
                  >
                    {t.label}
                    <span className="ml-1 opacity-70">({count})</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-2 border border-line bg-white" onClick={(e) => e.stopPropagation()}>
              {tab === "inkomsten" ? (
                <DetailTable
                  empty="Geen inkomsten in deze week."
                  columns={["Omschrijving", "Status", "Bedrag incl. btw"]}
                  rows={details.inkomsten.map((r) => [
                    r.label,
                    r.status === "betaald"
                      ? "Betaald"
                      : r.status === "open"
                        ? "Open"
                        : "Verwacht",
                    formatEuro(r.bedragIncBtw),
                  ])}
                  alignRight={[false, false, true]}
                  total={
                    details.inkomsten.length
                      ? formatEuro(
                          details.inkomsten.reduce(
                            (s, r) => s + r.bedragIncBtw,
                            0
                          )
                        )
                      : null
                  }
                />
              ) : null}

              {tab === "inkoop" ? (
                <DetailTable
                  empty="Geen inkoop gepland in deze week."
                  columns={["Product", "Order", "Inkoop ex. btw"]}
                  rows={details.inkoop.map((r) => [
                    r.product,
                    r.orderLabel,
                    formatEuro(r.bedragExBtw),
                  ])}
                  alignRight={[false, false, true]}
                  total={
                    details.inkoop.length
                      ? formatEuro(
                          details.inkoop.reduce((s, r) => s + r.bedragExBtw, 0)
                        )
                      : null
                  }
                />
              ) : null}

              {tab === "installatie" ? (
                <DetailTable
                  empty="Geen installatiekosten in deze week."
                  columns={["Project / order", "Kosten ex. btw"]}
                  rows={details.installatie.map((r) => [
                    r.label,
                    formatEuro(r.bedragExBtw),
                  ])}
                  alignRight={[false, true]}
                  total={
                    details.installatie.length
                      ? formatEuro(
                          details.installatie.reduce(
                            (s, r) => s + r.bedragExBtw,
                            0
                          )
                        )
                      : null
                  }
                />
              ) : null}

              {tab === "overig" ? (
                <DetailTable
                  empty="Geen overige kosten in deze week."
                  columns={["Omschrijving", "Bedrag"]}
                  rows={details.overig.map((r) => [
                    r.label,
                    formatEuro(r.bedrag),
                  ])}
                  alignRight={[false, true]}
                  total={
                    details.overig.length
                      ? formatEuro(
                          details.overig.reduce((s, r) => s + r.bedrag, 0)
                        )
                      : null
                  }
                />
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DetailTable({
  columns,
  rows,
  alignRight,
  empty,
  total,
}: {
  columns: string[];
  rows: string[][];
  alignRight: boolean[];
  empty: string;
  total: string | null;
}) {
  if (rows.length === 0) {
    return <p className="px-3 py-4 text-sm text-muted">{empty}</p>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line text-left text-[10px] font-semibold uppercase tracking-wide text-muted">
          {columns.map((c, i) => (
            <th
              key={c}
              className={[
                "px-3 py-2",
                alignRight[i] ? "text-right" : "",
              ].join(" ")}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className="border-b border-line/70">
            {row.map((cell, ci) => (
              <td
                key={ci}
                className={[
                  "px-3 py-2 text-ink",
                  alignRight[ci] ? "text-right tabular-nums" : "",
                ].join(" ")}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {total ? (
        <tfoot>
          <tr className="bg-wash/50">
            <td
              className="px-3 py-2 text-xs font-semibold uppercase text-muted"
              colSpan={Math.max(1, columns.length - 1)}
            >
              Totaal
            </td>
            <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums text-ink">
              {total}
            </td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

function SummaryCell({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "green" | "red" | "orange";
}) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p
        className={[
          "mt-1 font-display text-xl font-bold tabular-nums",
          tone === "green"
            ? "text-green-dark"
            : tone === "red"
              ? "text-[#C62828]"
              : tone === "orange"
                ? "text-[#C45A12]"
                : "text-ink",
        ].join(" ")}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[11px] leading-snug text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function FinancialDashboard({
  data,
  range,
  onRangeChange,
  loading,
}: {
  data: FinancialDashboardData | null;
  range: FinancialDateRange;
  onRangeChange: (r: FinancialDateRange) => void;
  loading?: boolean;
  adviseurs?: unknown[];
}) {
  if (loading && !data) {
    return (
      <p className="px-4 py-16 text-center text-sm text-muted">
        Cashflow laden…
      </p>
    );
  }

  if (!data?.freeCashflow) {
    return (
      <p className="px-4 py-16 text-center text-sm text-muted">
        Geen cashflow-data beschikbaar.
      </p>
    );
  }

  return (
    <div className="space-y-5 bg-wash/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            Cashflow
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Verwacht vs daadwerkelijk · inklapbare weekdetails
          </p>
        </div>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Ads-periode
          <select
            value={range}
            onChange={(e) =>
              onRangeChange(e.target.value as FinancialDateRange)
            }
            className="mt-1 block min-w-[11rem] border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
          >
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {financialRangeLabel(r)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <FreeCashflowPanel fc={data.freeCashflow} />
    </div>
  );
}

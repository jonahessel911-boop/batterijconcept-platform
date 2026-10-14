"use client";

import { useState } from "react";
import {
  addDays,
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
} from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type {
  ExpenseForecastByPost,
  ExpenseForecastLine,
  FinancialDashboardData,
  FinancialDateRange,
  FreeCashflowSnapshot,
  FreeCashflowWeekRow,
} from "@/lib/financial-dashboard";
import {
  financialRangeLabel,
  TARIK_FIXED_PER_WEEK,
  TARIK_PER_INGEPLANDE_AFSPRAAK,
} from "@/lib/financial-dashboard";
import { formatEuro } from "@/lib/format";
import { BankKasstroomPanel } from "./BankKasstroomPanel";

const AMS_TZ = "Europe/Amsterdam";

function postLabel(costPost: ExpenseForecastLine["costPost"]): string {
  if (costPost === "inkoop") return "purchasing";
  if (costPost === "loon") return "loon";
  if (costPost === "leads") return "leads";
  if (costPost === "btw") return "btw";
  if (costPost === "credit") return "credit";
  return costPost;
}

function groupLinesByWeek(lines: ExpenseForecastLine[]): {
  key: string;
  week: number;
  year: number;
  label: string;
  rangeLabel: string;
  totaal: number;
  lines: ExpenseForecastLine[];
}[] {
  const by = new Map<
    string,
    {
      key: string;
      week: number;
      year: number;
      label: string;
      rangeLabel: string;
      totaal: number;
      lines: ExpenseForecastLine[];
    }
  >();

  for (const line of lines) {
    const at = fromZonedTime(`${line.betaalDatum}T12:00:00`, AMS_TZ);
    const week = getISOWeek(at);
    const year = getISOWeekYear(at);
    const key = `${year}-W${week}`;
    let bucket = by.get(key);
    if (!bucket) {
      const monday = startOfISOWeek(at);
      const sunday = addDays(monday, 6);
      bucket = {
        key,
        week,
        year,
        label: `Week ${week}`,
        rangeLabel: `${formatInTimeZone(monday, AMS_TZ, "d MMM", { locale: nl })} – ${formatInTimeZone(sunday, AMS_TZ, "d MMM yyyy", { locale: nl })}`,
        totaal: 0,
        lines: [],
      };
      by.set(key, bucket);
    }
    bucket.lines.push(line);
    bucket.totaal = Math.round((bucket.totaal + line.bedrag) * 100) / 100;
  }

  return Array.from(by.values()).sort((a, b) =>
    a.key.localeCompare(b.key)
  );
}

const RANGES: FinancialDateRange[] = [
  "this_week",
  "last_7_days",
  "this_month",
  "last_30_days",
  "this_year",
  "all_time",
];

type WeekTab = "inkomsten" | "inkoop" | "installatie" | "sales" | "overig";

const WEEK_TABS: { id: WeekTab; label: string }[] = [
  { id: "inkomsten", label: "Inkomsten" },
  { id: "inkoop", label: "Purchasing" },
  { id: "installatie", label: "Installatie" },
  { id: "sales", label: "Sales" },
  { id: "overig", label: "Loon / BTW / Ads" },
];

function amountFor(
  rows: ExpenseForecastByPost[],
  key: ExpenseForecastByPost["key"]
): ExpenseForecastByPost | null {
  return rows.find((r) => r.key === key) || null;
}

function StandDashboard({ fc }: { fc: FreeCashflowSnapshot }) {
  const f = fc.expenseForecast;
  const [openWeeks, setOpenWeeks] = useState<Record<string, boolean>>({});
  if (!f) return null;

  const posts = f.twoWeekByCostPost || [];
  const purchasing = amountFor(posts, "inkoop");
  const installatie = amountFor(posts, "installatie");
  const loon = amountFor(posts, "loon");
  const leads = amountFor(posts, "leads");
  const sales = amountFor(posts, "sales");
  const credit = amountFor(posts, "credit");
  const btw = amountFor(posts, "btw");
  const uit = f.twoWeekTotaal ?? 0;
  const bank = fc.beginsaldo;
  const cashNa = round2(bank - uit);

  const costRows: {
    metric: string;
    waarde: number;
    berekening: string;
  }[] = [
    {
      metric: "Purchasing (te bestellen)",
      waarde: purchasing?.bedrag ?? 0,
      berekening:
        purchasing && purchasing.lines.length > 0
          ? `${purchasing.lines.length} orders · zelfde als Purchasing-tab Te bestellen`
          : "Geen orders in Purchasing · Te bestellen",
    },
    {
      metric: "Installatiekosten",
      waarde: installatie?.bedrag ?? 0,
      berekening:
        installatie && installatie.lines.length > 0
          ? `${installatie.lines.length}× gepland · €675 ex + 21% btw · ≤7d na installatie`
          : "Geen geplande installatie-betaling in 14d",
    },
    {
      metric: "Loonkosten Tarik",
      waarde: loon?.bedrag ?? 0,
      berekening: `€${TARIK_FIXED_PER_WEEK}/week vast + €${TARIK_PER_INGEPLANDE_AFSPRAAK}/ingeplande afspraak · maandag na ma–vr`,
    },
    {
      metric: "Leadkosten (ads)",
      waarde: leads?.bedrag ?? 0,
      berekening: "Doorlopend · weekgemiddelde ads-periode",
    },
    {
      metric: "Sales / commissie",
      waarde: sales?.bedrag ?? 0,
      berekening:
        "€250 bij betaalde aanbetaling · rest woensdag na installatie",
    },
    {
      metric: "Credit terugbetaling",
      waarde: credit?.bedrag ?? 0,
      berekening:
        credit && credit.lines.length > 0
          ? `${credit.lines.length}× · alleen als origineel betaald was`
          : "Geen openstaande terugbetalingen",
    },
    {
      metric: btw?.lines[0]?.label || "BTW-afdracht",
      waarde: btw?.bedrag ?? fc.btwTeBetalen ?? 0,
      berekening:
        fc.btwKwartaalLabel && fc.btwBetaalDatum
          ? `${fc.btwKwartaalLabel} · obv betaalde facturen · uiterlijk ${fc.btwBetaalDatum}`
          : "Obv betaalde facturen in het kwartaal (− credits)",
    },
  ];

  const visibleCosts = costRows.filter((r) => r.waarde > 0);
  // Geen individuele purchasing-regels in detail
  const twoWeekLines = (f.lines || []).filter((l) => {
    if (l.costPost === "inkoop") return false;
    if (l.costPost === "btw") return true;
    return (
      l.betaalDatum >= (f.twoWeekStart || "") &&
      l.betaalDatum <= (f.twoWeekEnd || "")
    );
  });
  const obligationWeeks = groupLinesByWeek(twoWeekLines);

  return (
    <section className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <div className="border-b border-line px-4 py-3">
          <p className="font-display text-base font-semibold text-ink">
            Cashstand · komende 14 dagen
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {f.twoWeekStart} t/m {f.twoWeekEnd} · beginsaldo minus kosten ·
            purchasing = tab Te bestellen
          </p>
        </div>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5 font-semibold">Post</th>
              <th className="px-3 py-2.5 font-semibold tabular-nums">Bedrag</th>
              <th className="px-4 py-2.5 font-semibold">Toelichting</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line/60 bg-wash/40">
              <td className="px-4 py-2.5 font-semibold text-ink">
                Beginsaldo (bank)
              </td>
              <td className="px-3 py-2.5 tabular-nums font-semibold text-green-deeper">
                {formatEuro(bank)}
              </td>
              <td className="px-4 py-2.5 text-muted">Vrije cash nu</td>
            </tr>
            {visibleCosts.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-6 text-center text-sm text-muted"
                >
                  Geen geplande uitgaven in de komende 14 dagen.
                </td>
              </tr>
            ) : (
              visibleCosts.map((r) => (
                <tr
                  key={r.metric}
                  className="border-b border-line/50"
                >
                  <td className="px-4 py-2.5 pl-8 text-ink">{r.metric}</td>
                  <td className="px-3 py-2.5 tabular-nums text-[#C62828]">
                    − {formatEuro(r.waarde)}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{r.berekening}</td>
                </tr>
              ))
            )}
            <tr className="border-t border-line bg-wash/60">
              <td className="px-4 py-3 font-semibold text-ink">
                = Rest na uitgaven
              </td>
              <td
                className={[
                  "px-3 py-3 tabular-nums font-semibold",
                  cashNa >= 0 ? "text-ink" : "text-[#C62828]",
                ].join(" ")}
              >
                {cashNa < 0
                  ? `− ${formatEuro(Math.abs(cashNa))}`
                  : formatEuro(cashNa)}
              </td>
              <td className="px-4 py-3 text-muted">
                beginsaldo − {formatEuro(uit)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {obligationWeeks.length === 0 ? (
        <div className="rounded-xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">
          Geen betaalverplichtingen in deze periode.
        </div>
      ) : (
        <div className="space-y-2">
          <p className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Wanneer betalen · klik week voor detail
          </p>
          {obligationWeeks.map((w) => {
            const open = openWeeks[w.key] === true;
            const posts = [
              ...new Set(w.lines.map((l) => postLabel(l.costPost))),
            ].join(" · ");
            return (
              <div
                key={w.key}
                className="overflow-hidden rounded-xl border border-line bg-white"
              >
                <button
                  type="button"
                  onClick={() =>
                    setOpenWeeks((prev) => ({
                      ...prev,
                      [w.key]: !open,
                    }))
                  }
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-wash/50"
                >
                  <span className="w-4 shrink-0 text-sm text-muted">
                    {open ? "▾" : "▸"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-sm font-semibold text-ink sm:text-base">
                      {w.label}
                      <span className="ml-2 text-xs font-normal text-muted">
                        {w.rangeLabel}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {w.lines.length}× · {posts}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-[#C62828]">
                    − {formatEuro(w.totaal)}
                  </p>
                </button>
                {open ? (
                  <ul className="divide-y divide-line/60 border-t border-line">
                    {w.lines.map((l, i) => (
                      <li
                        key={`${l.costPost}-${l.betaalDatum}-${i}`}
                        className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                      >
                        <div className="min-w-0 flex-1 pl-7">
                          <p className="text-sm font-medium text-ink">
                            <span className="text-muted">
                              {postLabel(l.costPost)}
                            </span>
                            <span className="mx-1.5 text-muted">·</span>
                            {l.label}
                          </p>
                          <p className="mt-0.5 text-xs text-muted">
                            {l.betaalDatum}
                            {l.wanneer ? ` · ${l.wanneer}` : ""}
                            {l.detail ? ` · ${l.detail}` : ""}
                          </p>
                        </div>
                        <p className="shrink-0 pl-7 text-sm font-semibold tabular-nums text-[#C62828] sm:pl-0">
                          − {formatEuro(l.bedrag)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function FreeCashflowPanel({ fc }: { fc: FreeCashflowSnapshot }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [tabByWeek, setTabByWeek] = useState<Record<string, WeekTab>>({});
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-2xl border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left sm:px-5"
      >
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Cashflow per week
          </p>
          <p className="mt-0.5 text-sm text-muted">
            {open ? "Inklappen" : "Openklappen voor weekdetail"}
          </p>
        </div>
        <span className="text-sm font-semibold text-ink">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <div className="border-t border-line px-4 pb-4 sm:px-5 sm:pb-5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <th className="w-8 px-2 py-2" />
                  <th className="px-2 py-2">Week</th>
                  <th className="px-2 py-2 text-right">Beginstand</th>
                  <th className="px-2 py-2 text-right">Verwacht binnen</th>
                  <th className="px-2 py-2 text-right">Daadwerkelijk</th>
                  <th className="px-2 py-2 text-right">Verwacht uit</th>
                  <th className="px-2 py-2 text-right">Eindstand</th>
                  <th className="px-2 py-2 text-right">Vrije cash</th>
                </tr>
              </thead>
              <tbody>
                {(fc.weeks || []).map((w) => {
                  const key = `${w.year}-W${w.week}`;
                  const isOpen = openKey === key;
                  const tab = tabByWeek[key] || "inkomsten";
                  return (
                    <WeekRow
                      key={key}
                      week={w}
                      open={isOpen}
                      tab={tab}
                      onToggle={() => setOpenKey(isOpen ? null : key)}
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
      ) : null}
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
    sales: [],
    overig: [],
  };
  const sales = details.sales || [];

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
                        : t.id === "sales"
                          ? sales.length
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
            <div
              className="mt-2 border border-line bg-white"
              onClick={(e) => e.stopPropagation()}
            >
              {tab === "inkomsten" ? (
                <DetailTable
                  empty="Geen inkomsten."
                  columns={["Omschrijving", "Status", "Bedrag"]}
                  rows={details.inkomsten.map((r) => [
                    r.label,
                    r.status,
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
                  empty="Geen purchasing."
                  columns={["Product", "Order", "Ex. btw"]}
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
                  empty="Geen installatie."
                  columns={["Project", "Installatie", "Betalen ≤", "Ex. btw"]}
                  rows={details.installatie.map((r) => [
                    r.label,
                    r.installatieAt?.slice(0, 10) || "—",
                    r.betaalAt?.slice(0, 10) || "—",
                    formatEuro(r.bedragExBtw),
                  ])}
                  alignRight={[false, false, false, true]}
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
              {tab === "sales" ? (
                <DetailTable
                  empty="Geen commissie."
                  columns={["Order", "Betalen", "Ex. btw"]}
                  rows={sales.map((r) => [
                    r.label,
                    r.betaalAt?.slice(0, 10) || "—",
                    formatEuro(r.bedragExBtw),
                  ])}
                  alignRight={[false, false, true]}
                  total={
                    sales.length
                      ? formatEuro(
                          sales.reduce((s, r) => s + r.bedragExBtw, 0)
                        )
                      : null
                  }
                />
              ) : null}
              {tab === "overig" ? (
                <DetailTable
                  empty="Geen overig."
                  columns={["Omschrijving", "Betalen", "Bedrag"]}
                  rows={details.overig.map((r) => [
                    r.label,
                    r.betaalAt?.slice(0, 10) || "—",
                    formatEuro(r.bedrag),
                  ])}
                  alignRight={[false, false, true]}
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
              className={["px-3 py-2", alignRight[i] ? "text-right" : ""].join(
                " "
              )}
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
        Financieel laden…
      </p>
    );
  }

  if (!data?.freeCashflow) {
    return (
      <p className="px-4 py-16 text-center text-sm text-muted">
        Geen financial data beschikbaar.
      </p>
    );
  }

  const fc = data.freeCashflow;

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold text-ink">
            Financieel
          </p>
          <p className="mt-0.5 max-w-2xl text-xs text-muted">
            Stand op de bank · uitgaven komende 14 dagen · purchasing bij
            geplande installatie · loon · ads · credit-terugbetalingen
          </p>
        </div>
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
          Ads-periode
          <select
            value={range}
            onChange={(e) =>
              onRangeChange(e.target.value as FinancialDateRange)
            }
            className="border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink outline-none focus:border-green"
          >
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {financialRangeLabel(r)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <StandDashboard fc={fc} />
      <BankKasstroomPanel />
      <FreeCashflowPanel fc={fc} />
    </div>
  );
}

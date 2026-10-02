"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatEuro, formatDateTimeNl } from "@/lib/format";
import type {
  DashboardV2Drilldown,
  DashboardV2Kpi,
  DashboardV2Period,
  DrilldownDay,
} from "@/lib/dashboard-v2";

const GOAL = "#1a8a3e";
const NOW = "#f37021";
const BAR_MAX = 180;

function dayValue(d: DrilldownDay, kpi: DashboardV2Kpi): number {
  switch (kpi) {
    case "leads":
      return d.leads;
    case "orders":
      return d.orders;
    case "afsprakenGepland":
      return d.afsprakenGepland;
    case "leadToAppt":
      return d.eersteAfspraken ?? d.afsprakenGepland;
    case "afspraakToSale":
      return d.afspraakToSale ?? 0;
    case "annuleringen":
      return d.annuleringen;
    case "omzet":
    case "sales":
      return d.omzet;
  }
}

function formatDayValue(n: number, kpi: DashboardV2Kpi): string {
  if (kpi === "omzet" || kpi === "sales") {
    if (Math.abs(n) >= 1000) {
      return `€${(n / 1000).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}k`;
    }
    return formatEuro(n);
  }
  if (kpi === "afspraakToSale" || kpi === "leadToAppt") {
    return `${n.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
  }
  return n.toLocaleString("nl-NL");
}

function formatRestDelta(n: number, kpi: DashboardV2Kpi): string {
  const abs = Math.abs(n);
  if (kpi === "omzet" || kpi === "sales") return formatEuro(abs);
  if (kpi === "afspraakToSale" || kpi === "leadToAppt") {
    return `${abs.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
  }
  return abs.toLocaleString("nl-NL", { maximumFractionDigits: 0 });
}

function granularityLabel(g: DashboardV2Drilldown["granularity"]): string {
  if (g === "week") return "Per week";
  if (g === "month") return "Per maand";
  return "Per dag";
}

function qs(
  period: DashboardV2Period,
  kpi: DashboardV2Kpi,
  fromDate: string,
  toDate: string,
  weekKey: string
): string {
  const p = new URLSearchParams({ period, kpi });
  if (period === "custom" && fromDate && toDate) {
    p.set("from", fromDate);
    p.set("to", toDate);
  }
  if (period === "calendar_week" && weekKey) {
    p.set("week", weekKey);
  }
  return p.toString();
}

export function KpiDetailOverlay({
  kpi,
  period,
  fromDate,
  toDate,
  weekKey = "",
  onClose,
}: {
  kpi: DashboardV2Kpi;
  period: DashboardV2Period;
  fromDate: string;
  toDate: string;
  weekKey?: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DashboardV2Drilldown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bucketFilter, setBucketFilter] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (period === "custom" && (!fromDate || !toDate)) return;
      if (period === "calendar_week" && !weekKey) return;
      setLoading(true);
      setError(null);
      setBucketFilter(null);
      try {
        const res = await fetch(
          `/api/dashboard-v2?${qs(period, kpi, fromDate, toDate, weekKey)}`
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Laden mislukt");
        if (!cancelled) setDetail(json.detail as DashboardV2Drilldown);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Fout");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kpi, period, fromDate, toDate, weekKey]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filteredRows = useMemo(() => {
    if (!detail) return [];
    if (!bucketFilter) return detail.rows;
    const bucket = detail.days.find((d) => d.key === bucketFilter);
    if (!bucket) return detail.rows;
    const startMs = new Date(bucket.start).getTime();
    const endMs = new Date(bucket.end).getTime();
    return detail.rows.filter((r) => {
      const t = new Date(r.at).getTime();
      return t >= startMs && t <= endMs;
    });
  }, [detail, bucketFilter]);

  const nBuckets = Math.max(detail?.days.length || 1, 1);
  const goalEach = detail
    ? detail.rateGoal
      ? detail.chartGoal
      : Math.round((detail.chartGoal / nBuckets) * 100) / 100
    : 0;
  const maxDay = Math.max(
    ...(detail?.days.map((d) => dayValue(d, kpi)) || [0]),
    goalEach,
    1
  );

  const seriesTitle = detail
    ? granularityLabel(detail.granularity)
    : "Verloop";

  const formatGoalValue = (n: number) => {
    if (kpi === "omzet" || kpi === "sales") return formatDayValue(n, kpi);
    if (detail?.rateGoal) {
      return `${n.toLocaleString("nl-NL", { maximumFractionDigits: 0 })}%`;
    }
    return formatDayValue(n, kpi === "leadToAppt" ? "afsprakenGepland" : kpi);
  };

  const progressPct =
    detail && detail.goal > 0
      ? Math.min(100, Math.max(0, (detail.actual / detail.goal) * 100))
      : 0;
  const progressHit =
    detail != null && detail.goal > 0 && detail.actual >= detail.goal;
  const progressRest =
    detail && detail.goal > 0
      ? progressHit
        ? `Doel behaald (+${formatRestDelta(detail.actual - detail.goal, kpi)})`
        : `Nog ${formatRestDelta(detail.goal - detail.actual, kpi)} tot doel`
      : null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-wash">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-line bg-white px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            KPI-rapportage · {detail?.periodLabel || "…"}
          </p>
          <h2 className="mt-0.5 font-display text-2xl font-semibold text-ink">
            {detail?.title || "Laden…"}
          </h2>
          {detail ? (
            <p className="mt-1 text-sm text-muted">
              <span className="font-semibold tabular-nums text-ink">
                {detail.actualLabel}
              </span>
              {" / doel "}
              <span className="font-semibold tabular-nums text-[#1a8a3e]">
                {detail.goalLabel}
              </span>
              {kpi === "leadToAppt" && detail.extras ? (
                <span className="ml-2">
                  · {detail.extras.afsprakenGepland} afspraken op{" "}
                  {detail.extras.leads} leads
                </span>
              ) : null}
              {kpi === "afspraakToSale" && detail.extras ? (
                <span className="ml-2">
                  · {detail.extras.orders ?? detail.extras.leads} sales op{" "}
                  {detail.extras.afsprakenVoltooid ??
                    detail.extras.afsprakenGepland}{" "}
                  afgeboekte afspraken
                </span>
              ) : null}
              <span className="ml-2 text-[12px]">
                ({detail.fromDate} 00:00 → {detail.toDate} 23:59 ·{" "}
                {detail.rows.length} regels)
              </span>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-wash"
        >
          Sluiten
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {loading ? (
          <p className="text-sm text-muted">Rapportage laden…</p>
        ) : error ? (
          <p className="rounded-xl border border-[#C62828]/30 bg-[#FFEBEE] px-3 py-2 text-sm text-[#C62828]">
            {error}
          </p>
        ) : detail ? (
          <div className="mx-auto max-w-6xl space-y-6">
            <section className="rounded-2xl border border-line bg-white p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Stand vs doel
                  </p>
                  <p className="mt-1 font-display text-xl font-semibold tabular-nums text-ink">
                    {detail.actualLabel}
                    <span className="mx-1.5 text-base font-normal text-muted">
                      van
                    </span>
                    <span className="text-[#1a8a3e]">{detail.goalLabel}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={[
                      "text-2xl font-semibold tabular-nums",
                      progressHit ? "text-[#1a8a3e]" : "text-ink",
                    ].join(" ")}
                  >
                    {Math.round(progressPct)}%
                  </p>
                  {progressRest ? (
                    <p className="mt-0.5 text-[12px] text-muted">{progressRest}</p>
                  ) : null}
                </div>
              </div>
              <div className="relative mt-4 h-3 overflow-hidden rounded-full bg-[#E8E6E1]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width]"
                  style={{
                    width: `${progressPct}%`,
                    background: progressHit ? GOAL : NOW,
                  }}
                />
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-muted">
                <span>0</span>
                <span>Doel {detail.goalLabel}</span>
              </div>
            </section>

            <section className="rounded-2xl border border-line bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-display text-base font-semibold text-ink">
                    {seriesTitle}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    Groen = nodig · oranje = behaald
                    {kpi === "leadToAppt"
                      ? " (afspraken t.o.v. afspraakendoel)"
                      : kpi === "afspraakToSale"
                        ? " (orders ÷ voltooide afspraken)"
                        : ""}{" "}
                    · klik om te filteren
                  </p>
                </div>
                {bucketFilter ? (
                  <button
                    type="button"
                    onClick={() => setBucketFilter(null)}
                    className="text-xs font-semibold text-green-dark hover:underline"
                  >
                    Filter wissen
                  </button>
                ) : null}
              </div>

              <div className="mt-4 overflow-x-auto pb-2">
                <div
                  className="flex h-56 items-end gap-2"
                  style={{
                    minWidth: Math.max(detail.days.length * 56, 320),
                  }}
                >
                  {detail.days.map((d) => {
                    const actual = dayValue(d, kpi);
                    const hG = Math.max(
                      goalEach > 0 ? 6 : 0,
                      (goalEach / maxDay) * BAR_MAX
                    );
                    const hA = Math.max(
                      actual > 0 ? 6 : 0,
                      (actual / maxDay) * BAR_MAX
                    );
                    const active = bucketFilter === d.key;
                    return (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() =>
                          setBucketFilter((prev) =>
                            prev === d.key ? null : d.key
                          )
                        }
                        className={[
                          "flex min-w-[3rem] flex-1 flex-col items-center justify-end self-stretch rounded-t-md px-0.5 transition",
                          active ? "bg-green-soft/60" : "hover:bg-wash",
                        ].join(" ")}
                        title={`${d.label}: nodig ${formatGoalValue(goalEach)} · behaald ${formatDayValue(actual, kpi === "leadToAppt" ? "afsprakenGepland" : kpi)}${
                          kpi === "leadToAppt" && d.leadToAppt != null
                            ? ` · L2A ${d.leadToAppt}%`
                            : kpi === "afspraakToSale" &&
                                d.afspraakToSale != null
                              ? ` · A2S ${d.afspraakToSale}%`
                              : ""
                        }`}
                      >
                        <div className="flex w-full max-w-[3.25rem] flex-1 items-end justify-center gap-0.5">
                          <div className="flex h-full w-[45%] flex-col items-center justify-end">
                            <span className="mb-0.5 text-[8px] font-semibold tabular-nums text-[#1a8a3e]">
                              {formatGoalValue(goalEach)}
                            </span>
                            <div
                              className="w-full rounded-t-md"
                              style={{ height: hG, background: GOAL }}
                            />
                          </div>
                          <div className="flex h-full w-[45%] flex-col items-center justify-end">
                            <span className="mb-0.5 text-[8px] font-semibold tabular-nums text-[#C45A12]">
                              {formatDayValue(
                                actual,
                                kpi === "leadToAppt"
                                  ? "afsprakenGepland"
                                  : kpi
                              )}
                            </span>
                            <div
                              className="w-full rounded-t-md"
                              style={{ height: hA, background: NOW }}
                            />
                          </div>
                        </div>
                        {kpi === "leadToAppt" && d.leadToAppt != null ? (
                          <span className="mt-0.5 text-[9px] font-medium text-[#1a8a3e]">
                            {d.leadToAppt.toLocaleString("nl-NL", {
                              maximumFractionDigits: 0,
                            })}
                            %
                          </span>
                        ) : null}
                        <p className="mt-1 w-full truncate text-center text-[9px] capitalize text-muted">
                          {d.label}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-line bg-white">
              <div className="border-b border-line px-4 py-3 sm:px-5">
                <p className="font-display text-base font-semibold text-ink">
                  {detail.rowKind === "leads"
                    ? "Alle leads"
                    : detail.rowKind === "afspraken"
                      ? kpi === "leadToAppt"
                        ? "Eerste afspraak per lead (geen heringepland)"
                        : kpi === "afspraakToSale"
                          ? "Voltooide afspraken (afgeboekt in agenda)"
                          : "Alle geplande afspraken"
                      : detail.rowKind === "sales"
                        ? "Sales medewerkers"
                        : "Alle orders"}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {filteredRows.length} rijen
                  {bucketFilter
                    ? ` · ${detail.days.find((d) => d.key === bucketFilter)?.label || bucketFilter}`
                    : " · hele periode"}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                      <th className="px-4 py-3 font-semibold">Wanneer</th>
                      <th className="px-4 py-3 font-semibold">Naam</th>
                      <th className="px-4 py-3 font-semibold">Detail</th>
                      <th className="px-4 py-3 font-semibold">Adviseur</th>
                      {detail.rowKind === "sales" ? (
                        <th className="min-w-[10rem] px-4 py-3 font-semibold">
                          Voortgang
                        </th>
                      ) : null}
                      <th className="px-4 py-3 font-semibold text-right">
                        Waarde
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={detail.rowKind === "sales" ? 6 : 5}
                          className="px-4 py-8 text-center text-muted"
                        >
                          Geen rijen in deze selectie.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((r) => {
                        const rowGoal = r.doel ?? 0;
                        const rowActual = r.waarde ?? 0;
                        const rowPct =
                          rowGoal > 0
                            ? Math.min(
                                100,
                                Math.max(0, (rowActual / rowGoal) * 100)
                              )
                            : 0;
                        const rowHit = rowGoal > 0 && rowActual >= rowGoal;
                        return (
                        <tr
                          key={r.id}
                          className="border-b border-line/70 last:border-0"
                        >
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted">
                            {r.dayKey ? formatDateTimeNl(r.at) : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              href={r.href}
                              className="font-medium text-green-dark hover:underline"
                            >
                              {r.titel}
                            </Link>
                            <p className="text-[11px] text-muted">
                              {r.subtitel}
                            </p>
                          </td>
                          <td className="max-w-xs px-4 py-3 text-muted">
                            {r.meta || "—"}
                          </td>
                          <td className="px-4 py-3 text-muted">
                            {r.adviseur || "—"}
                          </td>
                          {detail.rowKind === "sales" ? (
                            <td className="px-4 py-3">
                              {rowGoal > 0 ? (
                                <div>
                                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                                    <span
                                      className={[
                                        "font-semibold tabular-nums",
                                        rowHit
                                          ? "text-[#1a8a3e]"
                                          : "text-ink",
                                      ].join(" ")}
                                    >
                                      {Math.round(rowPct)}%
                                    </span>
                                    <span className="text-muted">
                                      {formatEuro(rowGoal)}
                                    </span>
                                  </div>
                                  <div className="relative h-2 overflow-hidden rounded-full bg-[#E8E6E1]">
                                    <div
                                      className="absolute inset-y-0 left-0 rounded-full"
                                      style={{
                                        width: `${rowPct}%`,
                                        background: rowHit ? GOAL : NOW,
                                      }}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                          ) : null}
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">
                            {r.waardeLabel || "—"}
                          </td>
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

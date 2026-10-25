"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDateTimeNl, formatEuro } from "@/lib/format";
import {
  SALES_MANAGER_PERIOD_LABELS,
  SALES_MANAGER_PERIODS,
  type SalesManagerPeriod,
  type SalesManagerPopup,
  type SalesManagerResolvedPeriod,
  type SalesManagerRow,
  type SalesManagerTotals,
} from "@/lib/sales-manager";

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
}

function KpiTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "green" | "orange" | "ink";
}) {
  const valueCls =
    accent === "green"
      ? "text-green-dark"
      : accent === "orange"
        ? "text-[#C45A12]"
        : "text-ink";
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-white px-4 py-4 shadow-[0_1px_0_rgba(26,31,28,0.04)]">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-green/0 via-green/50 to-green/0"
        aria-hidden
      />
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p
        className={[
          "mt-2 font-display text-[1.6rem] font-semibold leading-none tabular-nums tracking-tight",
          valueCls,
        ].join(" ")}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 text-[11px] text-muted">{hint}</p>
      ) : (
        <p className="mt-1.5 text-[11px] text-transparent">.</p>
      )}
    </div>
  );
}

function AdviseurPopup({
  popup,
  loading,
  error,
  onClose,
}: {
  popup: SalesManagerPopup | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
          <div>
            <p className="font-display text-base font-semibold text-ink">
              {popup?.naam || "Adviseur"}
            </p>
            <p className="text-[11px] text-muted">
              {popup?.periodLabel || "Periode"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-wash hover:text-ink"
          >
            Sluiten
          </button>
        </header>

        <div className="max-h-[calc(85vh-4rem)] overflow-y-auto px-4 py-4">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted">Laden…</p>
          ) : error ? (
            <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              {error}
            </p>
          ) : popup ? (
            <div className="space-y-5">
              <section>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Sales ({popup.sales.length})
                </p>
                {popup.sales.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">
                    Geen sales in deze periode.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-line border border-line">
                    {popup.sales.map((s) => (
                      <li
                        key={s.offerte_id}
                        className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
                      >
                        <div className="min-w-0">
                          {s.lead_id ? (
                            <Link
                              href={`/leads/${s.lead_id}`}
                              className="font-medium text-ink hover:underline"
                            >
                              {s.lead_naam}
                            </Link>
                          ) : (
                            <span className="font-medium text-ink">
                              {s.lead_naam}
                            </span>
                          )}
                          <p className="text-[11px] text-muted">
                            Getekend {formatDateTimeNl(s.ondertekend_op)}
                          </p>
                        </div>
                        <span className="shrink-0 tabular-nums font-semibold text-ink">
                          {s.bedrag_inc != null
                            ? formatEuro(s.bedrag_inc)
                            : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Niet afgeboekt ({popup.niet_afgeboekt.length})
                </p>
                {popup.niet_afgeboekt.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">
                    Geen openstaande afboekingen in deze periode.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-line border border-line">
                    {popup.niet_afgeboekt.map((a) => (
                      <li
                        key={a.afspraak_id}
                        className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/?tab=agenda&afspraak=${encodeURIComponent(a.afspraak_id)}`}
                            className="font-medium text-ink hover:underline"
                            onClick={onClose}
                          >
                            {a.lead_naam}
                          </Link>
                          <p className="text-[11px] text-muted">
                            {formatDateTimeNl(a.start_at)}
                          </p>
                        </div>
                        <Link
                          href={`/?tab=agenda&afspraak=${encodeURIComponent(a.afspraak_id)}`}
                          onClick={onClose}
                          className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[#C45A12] hover:underline"
                        >
                          Open in agenda
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function SalesManagerPanel() {
  const [period, setPeriod] = useState<SalesManagerPeriod>("last_week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rows, setRows] = useState<SalesManagerRow[]>([]);
  const [totals, setTotals] = useState<SalesManagerTotals | null>(null);
  const [periodMeta, setPeriodMeta] =
    useState<SalesManagerResolvedPeriod | null>(null);
  const [upcomingLabel, setUpcomingLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [popupId, setPopupId] = useState<string | null>(null);
  const [popup, setPopup] = useState<SalesManagerPopup | null>(null);
  const [popupLoading, setPopupLoading] = useState(false);
  const [popupError, setPopupError] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const qs = new URLSearchParams({ period });
    if (period === "custom" && customFrom && customTo) {
      qs.set("from", customFrom);
      qs.set("to", customTo);
    }
    return qs.toString();
  }, [period, customFrom, customTo]);

  const load = useCallback(
    async (qs: string, opts?: { silent?: boolean }) => {
      if (opts?.silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/sales-manager?${qs}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Laden mislukt"
          );
        }
        setRows(
          ((data as { rows?: SalesManagerRow[] }).rows ||
            []) as SalesManagerRow[]
        );
        setTotals(
          ((data as { totals?: SalesManagerTotals }).totals ||
            null) as SalesManagerTotals | null
        );
        setPeriodMeta(
          ((data as { period?: SalesManagerResolvedPeriod }).period ||
            null) as SalesManagerResolvedPeriod | null
        );
        setUpcomingLabel(
          (data as { upcomingWeekLabel?: string }).upcomingWeekLabel || ""
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Laden mislukt");
        setRows([]);
        setTotals(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    if (period === "custom" && (!customFrom || !customTo)) return;
    void load(queryString);
  }, [period, customFrom, customTo, queryString, load]);

  const openPopup = useCallback(
    async (adviseurId: string) => {
      setPopupId(adviseurId);
      setPopup(null);
      setPopupError(null);
      setPopupLoading(true);
      try {
        const qs = new URLSearchParams(queryString);
        qs.set("adviseur_id", adviseurId);
        qs.set("view", "popup");
        const res = await fetch(`/api/sales-manager?${qs}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Laden mislukt"
          );
        }
        setPopup(
          ((data as { popup?: SalesManagerPopup }).popup ||
            null) as SalesManagerPopup | null
        );
      } catch (e) {
        setPopupError(e instanceof Error ? e.message : "Laden mislukt");
      } finally {
        setPopupLoading(false);
      }
    },
    [queryString]
  );

  const t = totals;
  const periodLabel = periodMeta?.label || SALES_MANAGER_PERIOD_LABELS[period];

  const cell =
    "border border-line px-2.5 py-2 text-[12px] tabular-nums text-ink";
  const headCell =
    "border border-line bg-[#F3F5F4] px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink";

  return (
    <div className="space-y-5 px-4 py-4 sm:px-5 sm:py-5">
      <section className="relative overflow-hidden rounded-2xl border border-green/20 bg-[#0a4727] px-5 py-5 text-white sm:px-7 sm:py-6">
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-green/30 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
              Week sales
            </p>
            <h2 className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {periodLabel}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-white/70">
              {t
                ? `${t.sales} sale${t.sales === 1 ? "" : "s"} · ${fmtPct(t.conversie_gelopen_sale_pct)} gelopen→sale · aankomend ${t.afspraken_aankomende_week} huisbezoeken`
                : "Simpele conversieketen per adviseur"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={period}
              onChange={(e) =>
                setPeriod(e.target.value as SalesManagerPeriod)
              }
              className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/20 outline-none backdrop-blur"
            >
              {SALES_MANAGER_PERIODS.map((p) => (
                <option key={p} value={p} className="text-ink">
                  {SALES_MANAGER_PERIOD_LABELS[p]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void load(queryString, { silent: true })}
              disabled={refreshing || loading}
              className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/20 hover:bg-white/15 disabled:opacity-50"
            >
              {refreshing ? "Laden…" : "Vernieuwen"}
            </button>
          </div>
        </div>
        {period === "custom" ? (
          <div className="relative mt-4 flex flex-wrap items-center gap-2">
            <label className="text-[11px] text-white/70">
              Van
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="ml-1.5 rounded-lg border-0 bg-white/15 px-2 py-1.5 text-xs text-white outline-none"
              />
            </label>
            <label className="text-[11px] text-white/70">
              Tot
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="ml-1.5 rounded-lg border-0 bg-white/15 px-2 py-1.5 text-xs text-white outline-none"
              />
            </label>
          </div>
        ) : null}
      </section>

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Ingepland → gelopen"
          value={fmtPct(t?.conversie_ingepland_gelopen_pct)}
          hint={t ? `${t.gelopen}/${t.ingepland} afgeboekt` : undefined}
          accent="green"
        />
        <KpiTile
          label="Gelopen → sale"
          value={fmtPct(t?.conversie_gelopen_sale_pct)}
          hint={
            t
              ? `${t.sales} sales / ${t.gelopen} gelopen (bruto)`
              : undefined
          }
          accent="green"
        />
        <KpiTile
          label="Sales"
          value={t ? String(t.sales) : "—"}
          hint={periodLabel}
        />
        <KpiTile
          label="Niet afgeboekt"
          value={t ? String(t.niet_afgeboekt) : "—"}
          accent={t && t.niet_afgeboekt > 0 ? "orange" : "ink"}
          hint="In gekozen periode"
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3.5 sm:px-5">
          <div>
            <h3 className="font-display text-base font-semibold text-ink">
              Adviseurs
            </h3>
            <p className="text-[11px] text-muted">
              Conversieketen voor {periodLabel}
              {upcomingLabel ? ` · rechts: ${upcomingLabel}` : ""}
              {" · klik naam voor sales / niet afgeboekt"}
            </p>
          </div>
          <span className="rounded-full bg-wash px-2.5 py-1 text-[10px] font-semibold tabular-nums text-muted">
            {rows.length}
          </span>
        </div>

        <div className="overflow-x-auto p-3 sm:p-4">
          <table className="w-full min-w-[920px] border-collapse border border-line text-[12px]">
            <thead>
              <tr>
                <th className={headCell}>Adviseur</th>
                <th className={`${headCell} text-right`}>Ingepland</th>
                <th className={`${headCell} text-right`}>Gelopen</th>
                <th className={`${headCell} text-right`}>Niet afgeboekt</th>
                <th className={`${headCell} text-right`}>
                  Ingepland→gelopen
                </th>
                <th className={`${headCell} text-right`}>Sales</th>
                <th className={`${headCell} text-right`}>Gelopen→sale</th>
                <th className={`${headCell} text-right`}>
                  Aank. week
                  <span className="mt-0.5 block font-normal normal-case text-muted">
                    huisbezoeken
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className={`${cell} py-10 text-center text-muted`}
                  >
                    Laden…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className={`${cell} py-10 text-center text-muted`}
                  >
                    Geen actieve adviseurs.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.adviseur_id} className="hover:bg-[#FAFBFA]">
                    <td className={`${cell} text-left`}>
                      <button
                        type="button"
                        onClick={() => void openPopup(r.adviseur_id)}
                        className="text-left font-medium text-ink hover:underline"
                      >
                        {r.naam}
                      </button>
                    </td>
                    <td className={`${cell} text-right`}>{r.ingepland}</td>
                    <td className={`${cell} text-right`}>{r.gelopen}</td>
                    <td
                      className={[
                        cell,
                        "text-right",
                        r.niet_afgeboekt > 0
                          ? "font-semibold text-[#C45A12]"
                          : "",
                      ].join(" ")}
                    >
                      {r.niet_afgeboekt}
                    </td>
                    <td className={`${cell} text-right`}>
                      {fmtPct(r.conversie_ingepland_gelopen_pct)}
                    </td>
                    <td className={`${cell} text-right font-semibold`}>
                      {r.sales}
                    </td>
                    <td className={`${cell} text-right font-semibold text-green-dark`}>
                      {fmtPct(r.conversie_gelopen_sale_pct)}
                    </td>
                    <td className={`${cell} whitespace-nowrap text-right`}>
                      {r.afspraken_aankomende_week}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {popupId ? (
        <AdviseurPopup
          popup={popup}
          loading={popupLoading}
          error={popupError}
          onClose={() => {
            setPopupId(null);
            setPopup(null);
            setPopupError(null);
          }}
        />
      ) : null}
    </div>
  );
}

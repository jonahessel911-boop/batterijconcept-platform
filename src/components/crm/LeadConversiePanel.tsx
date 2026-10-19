"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LeadConversieResult } from "@/lib/lead-conversie";
import {
  CONVERSIE_PERIOD_LABELS,
  CONVERSIE_PERIODS,
  type ConversiePeriod,
} from "@/lib/conversie-period";
import { formatEuro } from "@/lib/format";

function num(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

export function LeadConversiePanel() {
  const [period, setPeriod] = useState<ConversiePeriod>("last_14_days");
  const [data, setData] = useState<LeadConversieResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [weekOpen, setWeekOpen] = useState(false);
  const [biOpen, setBiOpen] = useState(false);
  const [channelBusy, setChannelBusy] = useState(false);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async (p: ConversiePeriod) => {
    const soft = hasLoadedRef.current;
    if (soft) setChannelBusy(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/rapportage/lead-conversie?period=${encodeURIComponent(p)}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Laden mislukt"
        );
      }
      setData(json as LeadConversieResult);
      hasLoadedRef.current = true;
    } catch (e) {
      if (!soft) setData(null);
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
      setChannelBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [period, load]);

  const dag = data?.dag;
  const gepland = dag?.gehaald ?? 0;
  const doel = dag?.doel ?? 0;
  const nog = dag?.nog ?? 0;
  const pct = dag?.pct ?? 0;
  const finish = Boolean(dag?.finish);

  const week = data?.week;
  const geplandWeek = week?.gehaald ?? 0;
  const doelWeek = week?.doel ?? 0;
  const nogWeek = week?.nog ?? 0;
  const pctWeek = week?.pct ?? 0;
  const finishWeek = Boolean(week?.finish);

  const bi = data?.biweekly;
  const geplandBi = bi?.gehaald ?? 0;
  const doelBi = bi?.doel ?? 0;
  const nogBi = bi?.nog ?? 0;
  const pctBi = bi?.pct ?? 0;
  const finishBi = Boolean(bi?.finish);

  const weekLabels = ["Deze week", "Volgende week", "Week daarna"];
  const leadsNodig =
    data?.leadsNodigBiweekly ?? data?.leadsNodigMaand ?? 0;
  const sources = (data?.bySource || []).filter(
    (r) => r.source !== "Onbekend" || r.leads > 0
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="font-display text-lg font-semibold text-ink">
          Lead conversie dashboard
        </p>
        <p className="mt-0.5 max-w-2xl text-xs text-muted">
          Op schema voor lead-generatie komende 14 dagen · L→A = cohort
          afgelopen 14d (van die leads: hoeveel ingepland)
          {data?.leadToApptActueel != null
            ? ` (${num(data.leadToApptActueel, 1)}%)`
            : ""}
          {" · "}
          Open blokken × 2 ÷ L→A = lead-doel
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-muted">Laden…</p>
      ) : data ? (
        <>
          {/* Dag target — zelfde hoofdfinishlijn als bel conversie */}
          <div
            className={`rounded-2xl border p-5 sm:p-7 ${
              finish
                ? "border-green/40 bg-green-soft/50"
                : "border-line bg-white"
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              Dag target
            </p>
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums text-ink sm:text-5xl">
              {num(gepland)}
              <span className="text-2xl font-medium text-muted sm:text-3xl">
                {" "}
                / {doel > 0 ? num(doel) : "—"}
              </span>
              {finish ? (
                <span className="ml-3 text-2xl text-green-deeper">
                  Finish 🏁
                </span>
              ) : (
                <span className="ml-3 text-xl font-medium text-[#C45A12]">
                  · nog {num(nog)}
                </span>
              )}
            </p>
            <p className="mt-2 text-sm text-muted">
              Tempo om komende 14 dagen vol te plannen · L→A cohort 14d{" "}
              {data.leadToApptActueel != null
                ? `${num(data.leadToApptActueel, 1)}%`
                : "—"}
              {" · "}
              {num(data.l2aLeads)} leads · {num(data.l2aAfspraken)} daarvan
              ingepland
            </p>
            <div className="mt-5">
              <div className="relative h-4 overflow-hidden rounded-full bg-wash">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${
                    finish ? "bg-green" : "bg-[#C45A12]"
                  }`}
                  style={{ width: `${Math.max(pct, gepland > 0 ? 4 : 0)}%` }}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted">
                Over {num(data.werkdagenBiweekly)} bel-werkdagen ·{" "}
                {num(data.slotsOpenBiweekly)} open blokken × 2 ÷ L→A →{" "}
                {num(leadsNodig)} leads nodig
                {data.horizonWeeks?.[0]?.label
                  ? ` · ${data.horizonWeeks
                      .slice(0, 3)
                      .map((w) => `Week ${w.week}`)
                      .join(" · ")}`
                  : ""}
              </p>
              <button
                type="button"
                onClick={() => setAdminOpen((v) => !v)}
                className="border border-line bg-wash/60 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
              >
                {adminOpen ? "▾" : "▸"} Total target admin
              </button>
            </div>

            {adminOpen ? (
              <div className="mt-4 overflow-x-auto border border-line/70 bg-wash/30">
                <table className="w-full min-w-[420px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                      <th className="px-3 py-2 font-semibold">Horizon</th>
                      <th className="px-3 py-2 font-semibold tabular-nums">
                        Open blokken
                      </th>
                      <th className="px-3 py-2 font-semibold tabular-nums">
                        Nog vrij
                      </th>
                      <th className="px-3 py-2 font-semibold tabular-nums">
                        Lead-doel
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.horizonWeeks || []).slice(0, 3).map((w, i) => {
                      const afspraakDoel = w.slotsOpen * 2;
                      const l2a =
                        data.leadToApptActueel != null &&
                        data.leadToApptActueel > 0
                          ? data.leadToApptActueel
                          : 25;
                      const leadDoel =
                        afspraakDoel > 0
                          ? Math.ceil((afspraakDoel * 100) / l2a)
                          : 0;
                      return (
                        <tr
                          key={`admin-${w.jaar}-W${w.week}`}
                          className="border-b border-line/50"
                        >
                          <td className="px-3 py-2.5 text-ink">
                            <span className="font-medium">
                              {weekLabels[i] || `Week ${w.week}`}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted">
                              Week {w.week} · {w.label}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-ink">
                            {num(w.slotsOpen)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-ink">
                            {num(w.slotsVrij)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums font-semibold text-ink">
                            {num(leadDoel)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td className="px-3 py-2.5 text-ink">
                        <span className="font-medium">Bi-weekly totaal</span>
                        <span className="mt-0.5 block text-xs text-muted">
                          L→A{" "}
                          {data.leadToApptActueel != null
                            ? `${num(data.leadToApptActueel, 1)}%`
                            : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-ink">
                        {num(data.slotsOpenBiweekly)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-ink">—</td>
                      <td className="px-3 py-2.5 tabular-nums font-semibold text-ink">
                        {num(leadsNodig)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          {/* Week target — standaard ingeklapt, zelfde als bel */}
          <div
            className={`rounded-2xl border ${
              finishWeek
                ? "border-green/40 bg-green-soft/50"
                : "border-line bg-white"
            }`}
          >
            <button
              type="button"
              onClick={() => setWeekOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left sm:px-6"
            >
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Week target
                </p>
                {!weekOpen ? (
                  <p className="mt-0.5 text-sm text-muted">
                    Openklappen voor weekvoortgang
                  </p>
                ) : null}
              </div>
              <span className="text-sm font-semibold text-ink">
                {weekOpen ? "▾" : "▸"}
              </span>
            </button>
            {weekOpen ? (
              <div className="border-t border-line/60 px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
                <p className="font-display text-3xl font-semibold tabular-nums text-ink">
                  {num(geplandWeek)}
                  <span className="text-xl font-medium text-muted">
                    {" "}
                    / {doelWeek > 0 ? num(doelWeek) : "—"}
                  </span>
                  {finishWeek ? (
                    <span className="ml-2 text-xl text-green-deeper">
                      Finish 🏁
                    </span>
                  ) : (
                    <span className="ml-2 text-lg font-medium text-[#C45A12]">
                      · nog {num(nogWeek)}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Weekdoel = dagoel × 5 bel-werkdagen · leads binnen deze week
                </p>
                <div className="mt-4">
                  <div className="relative h-3 overflow-hidden rounded-full bg-wash">
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 ${
                        finishWeek ? "bg-green" : "bg-[#C45A12]"
                      }`}
                      style={{
                        width: `${Math.max(pctWeek, geplandWeek > 0 ? 4 : 0)}%`,
                      }}
                    />
                  </div>
                </div>
                <p className="mt-2 text-[11px] tabular-nums text-muted">
                  {pctWeek}%
                  {week?.rangeStart && week?.rangeEnd
                    ? ` · ${week.rangeStart} t/m ${week.rangeEnd}`
                    : ""}
                </p>
              </div>
            ) : null}
          </div>

          {/* Bi-weekly target — collapsible, zelfde stijl */}
          <div
            className={`rounded-2xl border ${
              finishBi
                ? "border-green/40 bg-green-soft/50"
                : "border-line bg-white"
            }`}
          >
            <button
              type="button"
              onClick={() => setBiOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left sm:px-6"
            >
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Bi-weekly target
                </p>
                {!biOpen ? (
                  <p className="mt-0.5 text-sm text-muted">
                    Openklappen voor bi-weekly voortgang
                  </p>
                ) : null}
              </div>
              <span className="text-sm font-semibold text-ink">
                {biOpen ? "▾" : "▸"}
              </span>
            </button>
            {biOpen ? (
              <div className="border-t border-line/60 px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
                <p className="font-display text-3xl font-semibold tabular-nums text-ink">
                  {num(geplandBi)}
                  <span className="text-xl font-medium text-muted">
                    {" "}
                    / {doelBi > 0 ? num(doelBi) : "—"}
                  </span>
                  {finishBi ? (
                    <span className="ml-2 text-xl text-green-deeper">
                      Finish 🏁
                    </span>
                  ) : (
                    <span className="ml-2 text-lg font-medium text-[#C45A12]">
                      · nog {num(nogBi)}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Primair: leads afgelopen 14d vs lead-doel komende 14d ·{" "}
                  {num(data.slotsOpenBiweekly)} open blokken × 2 ÷ L→A ={" "}
                  {num(leadsNodig)} leads nodig
                </p>
                <div className="mt-4">
                  <div className="relative h-3 overflow-hidden rounded-full bg-wash">
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 ${
                        finishBi ? "bg-green" : "bg-[#C45A12]"
                      }`}
                      style={{
                        width: `${Math.max(pctBi, geplandBi > 0 ? 4 : 0)}%`,
                      }}
                    />
                  </div>
                </div>
                <p className="mt-2 text-[11px] tabular-nums text-muted">
                  {pctBi}%
                  {bi?.rangeStart && bi?.rangeEnd
                    ? ` · ${bi.rangeStart} t/m ${bi.rangeEnd}`
                    : ""}
                </p>
              </div>
            ) : null}
          </div>

          {/* Per kanaal — eigen periodefilter */}
          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <p className="font-display text-base font-semibold text-ink">
                  Per kanaal
                </p>
                <p className="text-xs text-muted">
                  {data.periodLabel || CONVERSIE_PERIOD_LABELS[period]}
                  {data.rangeStartYmd && data.rangeEndYmd
                    ? ` · ${data.rangeStartYmd} t/m ${data.rangeEndYmd}`
                    : ""}
                  {" · "}
                  Meta spend {formatEuro(data.metaSpend ?? 0)} · L→A = van de
                  leads die in deze periode binnenkwamen, hoeveel daarvan een
                  huisbezoek hebben · Netto deals = getekend in periode (ig/fb →
                  Meta, minus annuleringen) · CPL = spend÷leads · CPA =
                  spend÷netto deals
                </p>
              </div>
              <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Periode
                <select
                  value={period}
                  disabled={channelBusy}
                  onChange={(e) =>
                    setPeriod(e.target.value as ConversiePeriod)
                  }
                  className="border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink outline-none focus:border-green disabled:opacity-60"
                >
                  {CONVERSIE_PERIODS.map((p) => (
                    <option key={p} value={p}>
                      {CONVERSIE_PERIOD_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {channelBusy ? (
              <p className="border-b border-line px-4 py-2 text-xs text-muted">
                Kanalen laden…
              </p>
            ) : null}
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-semibold">Bron</th>
                  <th className="px-3 py-3 font-semibold tabular-nums">
                    Leads
                  </th>
                  <th className="px-3 py-3 font-semibold tabular-nums">CPL</th>
                  <th className="px-3 py-3 font-semibold tabular-nums">
                    Afspraken
                  </th>
                  <th className="px-3 py-3 font-semibold tabular-nums">
                    L→A
                  </th>
                  <th className="px-3 py-3 font-semibold tabular-nums">
                    €/afspraak
                  </th>
                  <th className="px-3 py-3 font-semibold tabular-nums">
                    Netto deals
                  </th>
                  <th className="px-3 py-3 font-semibold tabular-nums">CPA</th>
                  <th className="px-4 py-3 font-semibold tabular-nums">
                    A→S
                  </th>
                </tr>
              </thead>
              <tbody>
                {sources.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-sm text-muted"
                    >
                      Geen leads in deze periode.
                    </td>
                  </tr>
                ) : (
                  sources.map((row) => {
                    const noPaid = row.source === "Native" || row.spend <= 0;
                    return (
                      <tr
                        key={row.source}
                        className="border-b border-line/50 last:border-0"
                      >
                        <td className="px-4 py-2.5 font-medium text-ink">
                          {row.source}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-ink">
                          {num(row.leads)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-ink">
                          {noPaid
                            ? "—"
                            : row.cpl != null
                              ? formatEuro(row.cpl)
                              : "—"}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-ink">
                          {num(row.afspraken)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-ink">
                          {row.leadToAppt != null
                            ? `${num(row.leadToAppt, 1)}%`
                            : "—"}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-ink">
                          {noPaid
                            ? "—"
                            : row.costPerAppointment != null
                              ? formatEuro(row.costPerAppointment)
                              : "—"}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-ink">
                          {num(row.deals)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums font-semibold text-ink">
                          {noPaid
                            ? "—"
                            : row.cpa != null
                              ? formatEuro(row.cpa)
                              : "—"}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-ink">
                          {row.apptToSale != null
                            ? `${num(row.apptToSale, 1)}%`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Ad-spend forecast onder Per kanaal */}
            {data.spendForecast ? (
              <div className="border-t border-line">
                <div className="border-b border-line px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Ad-spend forecast · Meta · komende 14 dagen
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    Obv huidige CPL / € per afspraak in de gekozen kanaalperiode
                    · open blokken = beschikbare slots
                  </p>
                </div>
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                      <th className="px-4 py-2.5 font-semibold">Metric</th>
                      <th className="px-3 py-2.5 font-semibold tabular-nums">
                        Waarde
                      </th>
                      <th className="px-4 py-2.5 font-semibold">Berekening</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-line/50">
                      <td className="px-4 py-2.5 font-medium text-ink">
                        Huidige CPL
                      </td>
                      <td className="px-3 py-2.5 tabular-nums font-semibold text-ink">
                        {data.spendForecast.cpl != null
                          ? formatEuro(data.spendForecast.cpl)
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted">spend ÷ leads</td>
                    </tr>
                    <tr className="border-b border-line/50">
                      <td className="px-4 py-2.5 font-medium text-ink">
                        € / afspraak
                      </td>
                      <td className="px-3 py-2.5 tabular-nums font-semibold text-ink">
                        {data.spendForecast.costPerAppointment != null
                          ? formatEuro(data.spendForecast.costPerAppointment)
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        spend ÷ afspraken
                      </td>
                    </tr>
                    <tr className="border-b border-line/50">
                      <td className="px-4 py-2.5 font-medium text-ink">
                        Budget via €/afspraak
                      </td>
                      <td className="px-3 py-2.5 tabular-nums font-semibold text-ink">
                        {data.spendForecast.spendViaCostPerAppt != null
                          ? formatEuro(data.spendForecast.spendViaCostPerAppt)
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {data.spendForecast.costPerAppointment != null
                          ? formatEuro(data.spendForecast.costPerAppointment)
                          : "—"}{" "}
                        × {num(data.spendForecast.slotsOpen)} open blokken
                      </td>
                    </tr>
                    <tr className="border-b border-line/50">
                      <td className="px-4 py-2.5 font-medium text-ink">
                        Budget via CPL
                      </td>
                      <td className="px-3 py-2.5 tabular-nums font-semibold text-ink">
                        {data.spendForecast.spendViaCpl != null
                          ? formatEuro(data.spendForecast.spendViaCpl)
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {data.spendForecast.cpl != null
                          ? formatEuro(data.spendForecast.cpl)
                          : "—"}{" "}
                        × {num(data.spendForecast.leadsNodig)} leads nodig (open
                        × 2 ÷ L→A)
                      </td>
                    </tr>
                    <tr className="last:border-0">
                      <td className="px-4 py-2.5 font-medium text-ink">
                        Budget via afspraak-doel
                      </td>
                      <td className="px-3 py-2.5 tabular-nums font-semibold text-ink">
                        {data.spendForecast.spendViaAfspraakDoel != null
                          ? formatEuro(data.spendForecast.spendViaAfspraakDoel)
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {data.spendForecast.costPerAppointment != null
                          ? formatEuro(data.spendForecast.costPerAppointment)
                          : "—"}{" "}
                        × {num(data.spendForecast.afspraakDoel)} afspraken (open
                        × 2)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ManagementDashboardData } from "@/lib/management-dashboard/types";
import type { GeoRegionMetrics } from "@/lib/rapportage";
import { formatEuro } from "@/lib/format";
import { RapportageMap } from "./RapportageMap";

type Period =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_7_days"
  | "last_14_days"
  | "last_30_days"
  | "this_quarter";

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
}

function num(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });
}

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return formatEuro(n);
}

function deltaLabel(deltaPct: number | null | undefined): {
  text: string;
  tone: "up" | "down" | "flat";
} {
  if (deltaPct == null || Number.isNaN(deltaPct)) {
    return { text: "vs vorige: —", tone: "flat" };
  }
  const rounded = Math.round(deltaPct * 10) / 10;
  if (rounded === 0) return { text: "vs vorige: gelijk", tone: "flat" };
  const sign = rounded > 0 ? "+" : "";
  return {
    text: `vs vorige: ${sign}${rounded.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`,
    tone: rounded > 0 ? "up" : "down",
  };
}

function deltaPctOf(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function BarPair({
  label,
  aLabel,
  aValue,
  bLabel,
  bValue,
  aColor = "#f37021",
  bColor = "#1f6b3a",
  footer,
}: {
  label: string;
  aLabel: string;
  aValue: number;
  bLabel: string;
  bValue: number;
  aColor?: string;
  bColor?: string;
  footer?: string;
}) {
  const max = Math.max(aValue, bValue, 1);
  const bars = [
    { label: aLabel, value: aValue, color: aColor },
    { label: bLabel, value: bValue, color: bColor },
  ];
  return (
    <div className="border border-line bg-white px-4 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <div className="mt-5 flex items-end justify-center gap-8 sm:gap-12">
        {bars.map((bar) => {
          const pctH = Math.min(100, (bar.value / max) * 100);
          return (
            <div
              key={bar.label}
              className="flex w-20 flex-col items-center sm:w-24"
            >
              <span className="mb-2 text-sm font-semibold tabular-nums text-ink">
                {num(bar.value)}
              </span>
              <div className="flex h-36 w-full items-end bg-wash">
                <div
                  className="w-full transition-all duration-300"
                  style={{
                    height: `${pctH}%`,
                    minHeight: bar.value > 0 ? 4 : 0,
                    background: bar.color,
                  }}
                />
              </div>
              <p className="mt-2 text-center text-[11px] leading-snug text-muted">
                {bar.label}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-center text-sm font-semibold text-ink">
        {footer || `${num(aValue)} / ${num(bValue)}`}
      </p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  subValue,
  hint,
  deltaPct,
}: {
  label: string;
  value: string;
  /** Kleine secundaire waarde naast/onder de main KPI */
  subValue?: string;
  hint?: string;
  /** undefined = geen delta-regel; null = onbekend */
  deltaPct?: number | null;
}) {
  const showDelta = deltaPct !== undefined;
  const d = showDelta ? deltaLabel(deltaPct) : null;
  return (
    <div className="border border-line bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="font-display text-2xl font-semibold tracking-tight text-ink">
          {value}
        </p>
        {subValue ? (
          <p className="text-sm tabular-nums text-muted">{subValue}</p>
        ) : null}
      </div>
      {d ? (
        <p
          className={[
            "mt-1 text-[11px] font-medium",
            d.tone === "up"
              ? "text-[#1f6b3a]"
              : d.tone === "down"
                ? "text-[#C45A12]"
                : "text-muted",
          ].join(" ")}
        >
          {d.text}
        </p>
      ) : null}
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function SalesKpiDashboard() {
  const [period, setPeriod] = useState<Period>("last_14_days");
  const [data, setData] = useState<ManagementDashboardData | null>(null);
  const [geo, setGeo] = useState<GeoRegionMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingDoel, setEditingDoel] = useState(false);
  const [doelDraft, setDoelDraft] = useState("");
  const [savingDoel, setSavingDoel] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mgmtRes, rappRes] = await Promise.all([
        fetch(`/api/management-dashboard?period=${period}`),
        fetch("/api/rapportage?financial_range=last_30_days"),
      ]);
      const mgmt = await mgmtRes.json().catch(() => ({}));
      const rapp = await rappRes.json().catch(() => ({}));
      if (!mgmtRes.ok) {
        throw new Error(mgmt.error || "Dashboard laden mislukt");
      }
      const dashboard = (mgmt.dashboard || mgmt) as ManagementDashboardData;
      setData(dashboard);
      setGeo((rapp.geo as GeoRegionMetrics[]) || []);
      setDoelDraft(String(dashboard.instellingen?.omzet_doel_maand ?? ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  async function saveDoel() {
    const n = Number(String(doelDraft).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      setError("Ongeldig omzetdoel");
      return;
    }
    setSavingDoel(true);
    setError(null);
    try {
      const res = await fetch("/api/management-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ omzet_doel_maand: n }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Opslaan mislukt");
      setEditingDoel(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSavingDoel(false);
    }
  }

  const derived = useMemo(() => {
    if (!data?.salesCompare) return null;
    const c = data.salesCompare;
    const cur = c.current;
    const prev = c.previous;
    const omzetDoel = data.instellingen.omzet_doel_maand;
    const salesAdviseurs = data.sales.adviseurs;
    const days = Math.max(1, c.periodDays);
    const leadsPerDay = Math.round((cur.leads / days) * 10) / 10;
    const prevLeadsPerDay = Math.round((prev.leads / days) * 10) / 10;

    return {
      cur,
      prev,
      compare: c,
      omzetDoel,
      adviseurs: salesAdviseurs,
      adviseurCount: c.adviseurCount,
      prevLabel: data.period.previousLabel,
      periodLabel: data.period.label,
      leadsPerDay,
      prevLeadsPerDay,
      deltas: {
        leads: deltaPctOf(leadsPerDay, prevLeadsPerDay),
        afsprakenGepland: deltaPctOf(
          cur.afsprakenGepland,
          prev.afsprakenGepland
        ),
        afsprakenVoltooid: deltaPctOf(
          cur.afsprakenVoltooid,
          prev.afsprakenVoltooid
        ),
        deals: deltaPctOf(cur.deals, prev.deals),
        leadToAppt:
          cur.leadToAppt != null && prev.leadToAppt != null
            ? Math.round((cur.leadToAppt - prev.leadToAppt) * 10) / 10
            : null,
        conversie:
          cur.conversieVoltooidSale != null &&
          prev.conversieVoltooidSale != null
            ? Math.round(
                (cur.conversieVoltooidSale - prev.conversieVoltooidSale) * 10
              ) / 10
            : null,
        orderwaarde: deltaPctOf(cur.orderwaarde, prev.orderwaarde),
        adSpend: deltaPctOf(cur.adSpend, prev.adSpend),
        betaaldeOmzet: null as number | null,
      },
      costPerSale:
        cur.deals > 0 && cur.adSpend > 0 ? cur.adSpend / cur.deals : null,
      costPerApp:
        cur.afsprakenGepland > 0 && cur.adSpend > 0
          ? cur.adSpend / cur.afsprakenGepland
          : null,
      betaaldeOmzet: data.finance.betaaldeOmzet,
    };
  }, [data]);

  if (loading && !data) {
    return (
      <p className="px-5 py-12 text-center text-sm text-muted">
        Dashboard laden…
      </p>
    );
  }

  if (error && !data) {
    return (
      <p className="mx-5 my-6 border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
        {error}
      </p>
    );
  }

  if (!data || !derived) return null;

  const { cur, prev, compare, deltas } = derived;
  const l2aDoelPct = compare.targetLeadToAppt * 100;

  return (
    <div className="space-y-5 px-5 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            Sales dashboard
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {derived.periodLabel}
            {derived.adviseurCount
              ? ` · ${derived.adviseurCount} adviseur${derived.adviseurCount === 1 ? "" : "s"}`
              : ""}
            {` · vs ${derived.prevLabel}`}
          </p>
        </div>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Periode
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="mt-1 block border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink outline-none focus:border-green"
          >
            <option value="this_week">Deze week</option>
            <option value="last_week">Vorige week</option>
            <option value="this_month">Deze maand</option>
            <option value="last_7_days">Laatste 7 dagen</option>
            <option value="last_14_days">Laatste 14 dagen</option>
            <option value="last_30_days">Laatste 30 dagen</option>
            <option value="this_quarter">Dit kwartaal</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-2 text-sm text-[#C45A12]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Leads / dag"
          value={num(derived.leadsPerDay)}
          subValue={`nodig ${num(compare.leadsNodigPerDag)}/dag`}
          deltaPct={deltas.leads}
          hint={`Totaal ${num(cur.leads)} · ${num(compare.leadsNodigPerWeekPerAdviseur)}/wk × ${num(compare.adviseurCount)} adviseur ÷ 7`}
        />
        <KpiCard
          label="Afspraken gepland"
          value={num(cur.afsprakenGepland)}
          deltaPct={deltas.afsprakenGepland}
          hint={`Doel slots: ${num(compare.slotsDoel)}`}
        />
        <KpiCard
          label="Afspraken voltooid"
          value={num(cur.afsprakenVoltooid)}
          deltaPct={deltas.afsprakenVoltooid}
          hint="Afgeboekt · bezoekdatum in periode"
        />
        <KpiCard
          label="Deals"
          value={num(cur.deals)}
          deltaPct={deltas.deals}
          hint="Ondertekende offertes in periode"
        />
        <KpiCard
          label="Conversie % voltooid → sale"
          value={pct(cur.conversieVoltooidSale)}
          hint={
            prev.conversieVoltooidSale != null
              ? `Was ${pct(prev.conversieVoltooidSale)} · Δ ${deltas.conversie != null && deltas.conversie > 0 ? "+" : ""}${deltas.conversie ?? "—"} ppt`
              : "Sale = ondertekende offerte"
          }
        />
        <KpiCard
          label="Lead → appointment"
          value={pct(cur.leadToAppt)}
          hint={
            prev.leadToAppt != null
              ? `Was ${pct(prev.leadToAppt)} · Δ ${deltas.leadToAppt != null && deltas.leadToAppt > 0 ? "+" : ""}${deltas.leadToAppt ?? "—"} ppt · doel ${l2aDoelPct}%`
              : `Doel ${l2aDoelPct}% (1/4)`
          }
        />
        <KpiCard
          label="Orderwaarde (ex btw)"
          value={money(cur.orderwaarde)}
          deltaPct={deltas.orderwaarde}
          hint="Totaal getekende omzet excl. btw"
        />
        <KpiCard
          label="Cost per sale"
          value={money(derived.costPerSale)}
          hint="Ad spend ÷ deals"
        />
        <KpiCard
          label="Cost per appointment"
          value={money(derived.costPerApp)}
          hint="Ad spend ÷ gepland"
        />
        <KpiCard
          label="Ad spend"
          value={money(cur.adSpend)}
          deltaPct={deltas.adSpend}
          hint="Alleen Meta lead-campagne"
        />
        <div className="border border-line bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Betaalde omzet
          </p>
          <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            {money(derived.betaaldeOmzet)}
          </p>
        </div>
        <div className="border border-line bg-white px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Omzetdoel (maand)
            </p>
            {!editingDoel ? (
              <button
                type="button"
                onClick={() => setEditingDoel(true)}
                className="text-muted hover:text-ink"
                title="Doel bewerken"
                aria-label="Doel bewerken"
              >
                ✎
              </button>
            ) : null}
          </div>
          {editingDoel ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={doelDraft}
                onChange={(e) => setDoelDraft(e.target.value)}
                className="border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              />
              <button
                type="button"
                disabled={savingDoel}
                onClick={() => void saveDoel()}
                className="bg-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {savingDoel ? "…" : "Bewaar"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingDoel(false);
                  setDoelDraft(String(derived.omzetDoel));
                }}
                className="border border-line px-3 py-2 text-xs font-semibold text-ink"
              >
                Annuleer
              </button>
            </div>
          ) : (
            <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
              {money(derived.omzetDoel)}
            </p>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
          Vergelijking · {derived.periodLabel} vs {derived.prevLabel}
        </h3>
        <p className="mt-1 text-sm text-muted">
          Leads-doel per dag: {num(compare.leadsNodigPerWeekPerAdviseur)}{" "}
          leads/week × {num(compare.adviseurCount)} sales-adviseur
          {compare.adviseurCount === 1 ? "" : "s"} ÷ 7 ={" "}
          <span className="font-semibold text-ink">
            {num(compare.leadsNodigPerDag)}/dag
          </span>
          {" · "}
          over {compare.periodDays} dagen: {num(compare.leadsNodigDoel)} leads
          voor {num(compare.slotsDoel)} slots (L2A {l2aDoelPct}%).
        </p>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <BarPair
            label="Leads / dag vs nodig"
            aLabel="Nu / dag"
            aValue={derived.leadsPerDay}
            bLabel="Nodig / dag"
            bValue={compare.leadsNodigPerDag}
            footer={
              cur.leadsVsNodig != null
                ? `${pct(cur.leadsVsNodig)} van dagoel · totaal ${num(cur.leads)}`
                : `totaal ${num(cur.leads)}`
            }
          />
          <BarPair
            label={`Leads / dag (${derived.prevLabel})`}
            aLabel="Toen / dag"
            aValue={derived.prevLeadsPerDay}
            bLabel="Nodig / dag"
            bValue={compare.leadsNodigPerDag}
            aColor="#1f6b3a"
            bColor="#f37021"
            footer={
              prev.leadsVsNodig != null
                ? `${pct(prev.leadsVsNodig)} van dagoel · totaal ${num(prev.leads)}`
                : `totaal ${num(prev.leads)}`
            }
          />
          <BarPair
            label="Lead → appointment %"
            aLabel="Nu"
            aValue={cur.leadToAppt ?? 0}
            bLabel="Vorige"
            bValue={prev.leadToAppt ?? 0}
            footer={`Doel ${l2aDoelPct}% · Δ ${deltas.leadToAppt != null && deltas.leadToAppt > 0 ? "+" : ""}${deltas.leadToAppt ?? "—"} ppt`}
          />
          <BarPair
            label="Afspraken gepland"
            aLabel="Nu"
            aValue={cur.afsprakenGepland}
            bLabel="Vorige"
            bValue={prev.afsprakenGepland}
            aColor="#1f6b3a"
            bColor="#f37021"
            footer={`Doel ${num(compare.slotsDoel)} slots`}
          />
          <BarPair
            label="Conversie voltooid → sale %"
            aLabel="Nu"
            aValue={cur.conversieVoltooidSale ?? 0}
            bLabel="Vorige"
            bValue={prev.conversieVoltooidSale ?? 0}
            footer={`Δ ${deltas.conversie != null && deltas.conversie > 0 ? "+" : ""}${deltas.conversie ?? "—"} ppt`}
          />
          <BarPair
            label="Deals"
            aLabel="Nu"
            aValue={cur.deals}
            bLabel="Vorige"
            bValue={prev.deals}
            aColor="#1f6b3a"
            bColor="#f37021"
          />
        </div>
      </div>

      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
          Omzet per adviseur
        </h3>
        <div className="mt-2 overflow-x-auto border border-line bg-white">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-wash/50 text-left text-[10px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Adviseur</th>
                <th className="px-3 py-2 text-right">Leads</th>
                <th className="px-3 py-2 text-right">Gepland</th>
                <th className="px-3 py-2 text-right">Voltooid</th>
                <th className="px-3 py-2 text-right">Deals</th>
                <th className="px-3 py-2 text-right">Omzet</th>
              </tr>
            </thead>
            <tbody>
              {derived.adviseurs.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-muted"
                  >
                    Geen adviseurs met salesrol.
                  </td>
                </tr>
              ) : (
                derived.adviseurs.map((a) => (
                  <tr key={a.id} className="border-b border-line">
                    <td className="px-3 py-2.5 font-medium text-ink">
                      {a.naam}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {a.leads}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {a.afsprakenGepland}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {a.afsprakenUitgevoerd}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {a.deals}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {money(a.omzetGetekend)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="border border-line bg-white">
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            Kaart Nederland
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            Leads en afspraken per provincie.
          </p>
        </div>
        <RapportageMap regions={geo} />
      </div>
    </div>
  );
}

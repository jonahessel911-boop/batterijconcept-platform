"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatEuro } from "@/lib/format";
import {
  PERIOD_PRESET_LABELS,
  type MgmtPeriodPreset,
  type ManagementDashboardData,
  type MgmtKpi,
  type MgmtAlert,
  type DrilldownRef,
  type DashboardInstellingen,
} from "@/lib/management-dashboard";

type TabId =
  | "directie"
  | "marketing"
  | "sales"
  | "orders"
  | "finance"
  | "instellingen";

const TABS: { id: TabId; label: string }[] = [
  { id: "directie", label: "Directie-overzicht" },
  { id: "marketing", label: "Marketing & funnel" },
  { id: "sales", label: "Sales & adviseurs" },
  { id: "orders", label: "Orders & installaties" },
  { id: "finance", label: "Finance" },
  { id: "instellingen", label: "Doelen" },
];

const PRESETS = Object.keys(PERIOD_PRESET_LABELS) as MgmtPeriodPreset[];

function formatKpiValue(kpi: MgmtKpi): string {
  if (kpi.value == null) return "Nog geen data";
  if (kpi.format === "money" || kpi.format === "euro_per") {
    return formatEuro(kpi.value);
  }
  if (kpi.format === "percent") {
    return `${kpi.value.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
  }
  return kpi.value.toLocaleString("nl-NL", { maximumFractionDigits: 1 });
}

function toneClass(tone: MgmtKpi["tone"]) {
  if (tone === "green") return "border-green/40 bg-green-soft/40";
  if (tone === "orange") return "border-[#F37021]/40 bg-[#FFF0E6]";
  if (tone === "red") return "border-[#C62828]/40 bg-[#FDECEC]";
  return "border-line bg-white";
}

function Delta({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[10px] text-muted">—</span>;
  const up = pct >= 0;
  return (
    <span
      className={[
        "text-[11px] font-semibold tabular-nums",
        up ? "text-green-dark" : "text-[#C62828]",
      ].join(" ")}
    >
      {up ? "↑" : "↓"} {Math.abs(pct).toLocaleString("nl-NL")}%
    </span>
  );
}

function KpiCard({
  kpi,
  onOpen,
}: {
  kpi: MgmtKpi;
  onOpen: (d: DrilldownRef) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(kpi.drilldown)}
      title={kpi.definition}
      className={[
        "rounded-xl border p-3.5 text-left shadow-[0_1px_2px_rgba(26,31,28,0.04)] transition hover:shadow-md",
        toneClass(kpi.tone),
      ].join(" ")}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {kpi.label}
      </p>
      <p className="mt-1.5 font-display text-xl font-bold tabular-nums text-ink sm:text-2xl">
        {formatKpiValue(kpi)}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Delta pct={kpi.deltaPct} />
        {kpi.target != null && (
          <span className="text-[10px] text-muted">
            Doel{" "}
            {kpi.format === "money" || kpi.format === "euro_per"
              ? formatEuro(kpi.target)
              : kpi.format === "percent"
                ? `${kpi.target}%`
                : kpi.target}
            {kpi.vsTarget != null && (
              <>
                {" "}
                (
                {kpi.vsTarget >= 0 ? "+" : ""}
                {kpi.format === "money"
                  ? formatEuro(kpi.vsTarget)
                  : kpi.vsTarget.toLocaleString("nl-NL")}
                )
              </>
            )}
          </span>
        )}
      </div>
      {kpi.missing ? (
        <p className="mt-1 text-[10px] leading-snug text-[#C45A12]">
          {kpi.missing}
        </p>
      ) : (
        <p className="mt-1 text-[10px] leading-snug text-muted line-clamp-2">
          {kpi.definition}
        </p>
      )}
    </button>
  );
}

function AlertList({
  alerts,
  onOpen,
}: {
  alerts: MgmtAlert[];
  onOpen: (d: DrilldownRef) => void;
}) {
  if (!alerts.length) {
    return (
      <p className="text-sm text-muted">Geen actuele aandachtspunten.</p>
    );
  }
  const color = (s: MgmtAlert["severity"]) =>
    s === "kritiek"
      ? "border-[#C62828]/30 bg-[#FDECEC]"
      : s === "positief"
        ? "border-green/30 bg-green-soft/50"
        : "border-[#F37021]/30 bg-[#FFF0E6]";

  return (
    <ul className="space-y-2">
      {alerts.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            disabled={!a.drilldown}
            onClick={() => a.drilldown && onOpen(a.drilldown)}
            className={[
              "w-full rounded-xl border px-4 py-3 text-left",
              color(a.severity),
              a.drilldown ? "cursor-pointer hover:opacity-90" : "",
            ].join(" ")}
          >
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
              {a.severity}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-ink">{a.title}</p>
            <p className="mt-0.5 text-xs text-muted">{a.detail}</p>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DrilldownDrawer({
  open,
  onClose,
  drillRef,
}: {
  open: boolean;
  onClose: () => void;
  drillRef: DrilldownRef | null;
}) {
  if (!open || !drillRef) return null;

  const hrefFor = (id: string) => {
    if (drillRef.kind === "leads") return `/leads/${id}`;
    if (drillRef.kind === "deals" || drillRef.kind === "offertes")
      return `/offertes`;
    if (drillRef.kind === "projecten") return `/projecten`;
    if (drillRef.kind === "facturen") return `/facturen`;
    return "/";
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="flex h-full w-full max-w-md flex-col border-l border-line bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Detail
            </p>
            <p className="font-display text-lg font-semibold text-ink">
              {drillRef.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted hover:text-ink"
          >
            Sluiten
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {drillRef.ids.length === 0 ? (
            <p className="text-sm text-muted">
              Geen individuele records gekoppeld aan deze KPI, of de lijst is te
              groot. Gebruik de filters of ga naar de betreffende module.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {drillRef.ids.slice(0, 80).map((id) => (
                <li key={id}>
                  <Link
                    href={hrefFor(id)}
                    className="block rounded-lg border border-line px-3 py-2 font-mono text-xs hover:bg-wash"
                  >
                    {id.slice(0, 8)}… → open
                  </Link>
                </li>
              ))}
              {drillRef.ids.length > 80 && (
                <li className="text-xs text-muted">
                  +{drillRef.ids.length - 80} meer
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function FiltersBar({
  data,
  period,
  setPeriod,
  lookback,
  setLookback,
  filters,
  setFilter,
  onReload,
}: {
  data: ManagementDashboardData | null;
  period: MgmtPeriodPreset;
  setPeriod: (p: MgmtPeriodPreset) => void;
  lookback: 30 | 60 | 90;
  setLookback: (n: 30 | 60 | 90) => void;
  filters: Record<string, string>;
  setFilter: (k: string, v: string) => void;
  onReload: () => void;
}) {
  const opts = data?.filterOptions;
  return (
    <div className="space-y-3 border-b border-line bg-wash/60 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.filter((p) => p !== "custom").map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={[
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
              period === p
                ? "border-green bg-green text-white"
                : "border-line bg-white text-muted hover:bg-white",
            ].join(" ")}
          >
            {PERIOD_PRESET_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <label className="text-[10px] font-semibold uppercase text-muted">
          Adviseur
          <select
            value={filters.adviseur_id || ""}
            onChange={(e) => setFilter("adviseur_id", e.target.value)}
            className="mt-1 w-full border border-line bg-white px-2 py-2 text-sm"
          >
            <option value="">Alle</option>
            {(opts?.adviseurs || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.naam}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-semibold uppercase text-muted">
          Leadbron
          <select
            value={filters.leadbron || ""}
            onChange={(e) => setFilter("leadbron", e.target.value)}
            className="mt-1 w-full border border-line bg-white px-2 py-2 text-sm"
          >
            <option value="">Alle</option>
            {(opts?.leadbronnen || []).map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-semibold uppercase text-muted">
          Meta-campagne
          <select
            value={filters.campaign || ""}
            onChange={(e) => setFilter("campaign", e.target.value)}
            className="mt-1 w-full border border-line bg-white px-2 py-2 text-sm"
          >
            <option value="">Alle</option>
            {(opts?.campagnes || []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-semibold uppercase text-muted">
          Regio
          <select
            value={filters.regio || ""}
            onChange={(e) => setFilter("regio", e.target.value)}
            className="mt-1 w-full border border-line bg-white px-2 py-2 text-sm"
          >
            <option value="">Alle</option>
            {(opts?.regios || []).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-semibold uppercase text-muted">
          Orderstatus
          <select
            value={filters.order_status || ""}
            onChange={(e) => setFilter("order_status", e.target.value)}
            className="mt-1 w-full border border-line bg-white px-2 py-2 text-sm"
          >
            <option value="">Alle</option>
            {(opts?.orderStatuses || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-semibold uppercase text-muted">
          Installateur
          <select
            value={filters.installateur_id || ""}
            onChange={(e) => setFilter("installateur_id", e.target.value)}
            className="mt-1 w-full border border-line bg-white px-2 py-2 text-sm"
          >
            <option value="">Alle</option>
            {(opts?.installateurs || []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.naam}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-semibold uppercase text-muted">
          Product/model
          <select
            value={filters.product || ""}
            onChange={(e) => setFilter("product", e.target.value)}
            className="mt-1 w-full border border-line bg-white px-2 py-2 text-sm"
          >
            <option value="">Alle</option>
            {(opts?.producten || []).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-semibold uppercase text-muted">
          Forecast lookback
          <select
            value={lookback}
            onChange={(e) =>
              setLookback(Number(e.target.value) as 30 | 60 | 90)
            }
            className="mt-1 w-full border border-line bg-white px-2 py-2 text-sm"
          >
            <option value={30}>30 dagen</option>
            <option value={60}>60 dagen</option>
            <option value={90}>90 dagen</option>
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={onReload}
            className="w-full border border-line bg-white px-3 py-2 text-sm font-semibold hover:bg-wash"
          >
            Vernieuwen
          </button>
        </div>
      </div>
    </div>
  );
}

function InstellingenForm({
  initial,
  onSaved,
}: {
  initial: DashboardInstellingen;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/management-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setMsg("Opgeslagen.");
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  const fields: { key: keyof DashboardInstellingen; label: string; step?: string }[] = [
    { key: "omzet_doel_maand", label: "Maandomzetdoel (€ excl. btw)" },
    { key: "winst_doel_maand", label: "Maandwinstdoel (€)" },
    { key: "minimale_marge_pct", label: "Minimale marge %" },
    { key: "max_cpl", label: "Max CPL (€)" },
    { key: "max_kosten_per_afspraak", label: "Max kosten per afspraak (€)" },
    { key: "max_kosten_per_sale", label: "Max kosten per sale (€)" },
    { key: "doel_lead_to_appointment", label: "Doel lead→afspraak %" },
    { key: "doel_show_rate", label: "Doel show-rate %" },
    { key: "doel_closing_rate", label: "Doel closing %" },
    { key: "slots_per_adviseur_per_week", label: "Slots per adviseur/week" },
    { key: "installaties_per_week", label: "Installatiecapaciteit/week" },
    { key: "standaard_installatie", label: "Standaard installatiekosten (€)" },
    { key: "verwachte_betaaltermijn_dagen", label: "Betaaltermijn (dagen)" },
    { key: "max_doorlooptijd_fase_dagen", label: "Max doorlooptijd fase (dagen)" },
    { key: "btw_reservering", label: "BTW-reservering (€)" },
  ];

  return (
    <form onSubmit={(e) => void save(e)} className="mx-auto max-w-3xl space-y-4">
      <p className="text-sm text-muted">
        Deze waarden sturen signalen, forecasts en capaciteitsberekeningen. Vereist
        migratie <code className="text-xs">migrate-management-dashboard.sql</code>.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="text-[10px] font-semibold uppercase text-muted">
            {f.label}
            <input
              type="number"
              step="any"
              value={Number(form[f.key] ?? 0)}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  [f.key]: Number(e.target.value),
                }))
              }
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm"
            />
          </label>
        ))}
        <label className="text-[10px] font-semibold uppercase text-muted">
          Beginsaldo cash (€) — leeg = onbekend
          <input
            type="number"
            step="any"
            value={form.beginsaldo_cash ?? ""}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                beginsaldo_cash:
                  e.target.value === "" ? null : Number(e.target.value),
              }))
            }
            className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm"
            placeholder="Nog geen data"
          />
        </label>
        <label className="text-[10px] font-semibold uppercase text-muted">
          Forecast lookback
          <select
            value={form.forecast_lookback_dagen}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                forecast_lookback_dagen: Number(e.target.value) as 30 | 60 | 90,
              }))
            }
            className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm"
          >
            <option value={30}>30</option>
            <option value={60}>60</option>
            <option value={90}>90</option>
          </select>
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
      >
        {busy ? "Opslaan…" : "Opslaan"}
      </button>
      {msg && <p className="text-sm text-green-dark">{msg}</p>}
    </form>
  );
}

export function ManagementDashboard() {
  const [tab, setTab] = useState<TabId>("directie");
  const [period, setPeriod] = useState<MgmtPeriodPreset>("this_month");
  const [lookback, setLookback] = useState<30 | 60 | 90>(60);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [data, setData] = useState<ManagementDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missingTables, setMissingTables] = useState<Record<string, boolean>>(
    {}
  );
  const [drill, setDrill] = useState<DrilldownRef | null>(null);

  const setFilter = useCallback((k: string, v: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (!v) delete next[k];
      else next[k] = v;
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        period,
        lookback: String(lookback),
        ...filters,
      });
      const res = await fetch(`/api/management-dashboard?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData(json.dashboard);
      setMissingTables(json.missingTables || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [period, lookback, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDrill = (d: DrilldownRef) => setDrill(d);

  const periodLabel = useMemo(() => {
    if (!data) return PERIOD_PRESET_LABELS[period];
    return data.period.label;
  }, [data, period]);

  return (
    <div className="min-h-[70vh] bg-white">
      <div className="border-b border-line px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-ink sm:text-2xl">
              Managementdashboard
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Periode: {periodLabel}
              {data?.meta.warning ? ` · ${data.meta.warning}` : ""}
            </p>
          </div>
          {Object.values(missingTables).some(Boolean) && (
            <p className="max-w-sm rounded-lg border border-[#F37021]/40 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              Voer <strong>migrate-management-dashboard.sql</strong> uit in
              Supabase voor doelen en Meta-campagne detail.
            </p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                "rounded-lg px-3 py-1.5 text-xs font-semibold",
                tab === t.id
                  ? "bg-green text-white"
                  : "bg-wash text-muted hover:text-ink",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab !== "instellingen" && (
        <FiltersBar
          data={data}
          period={period}
          setPeriod={setPeriod}
          lookback={lookback}
          setLookback={setLookback}
          filters={filters}
          setFilter={setFilter}
          onReload={() => void load()}
        />
      )}

      {error && (
        <p className="mx-4 mt-3 border border-[#C62828]/30 bg-[#FDECEC] px-3 py-2 text-sm text-[#C62828]">
          {error}
        </p>
      )}

      {loading && !data ? (
        <p className="p-8 text-center text-sm text-muted">Dashboard laden…</p>
      ) : !data ? null : (
        <div className="space-y-6 p-4 sm:p-5">
          {tab === "directie" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {data.directie.kpis.map((k) => (
                  <KpiCard key={k.key} kpi={k} onOpen={openDrill} />
                ))}
              </div>

              <section className="rounded-xl border border-line bg-white p-4 shadow-sm">
                <h3 className="font-display text-lg font-semibold text-ink">
                  Wat heeft vandaag aandacht nodig?
                </h3>
                <div className="mt-3">
                  <AlertList
                    alerts={data.directie.alerts}
                    onOpen={openDrill}
                  />
                </div>
              </section>

              <section className="rounded-xl border border-line bg-white p-4 shadow-sm">
                <h3 className="font-display text-lg font-semibold text-ink">
                  Doelstelling & forecast (deze maand)
                </h3>
                <p className="mt-1 text-xs text-muted">
                  Lookback conversies: {data.directie.forecast.lookbackDays}{" "}
                  dagen
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Omzetdoel", formatEuro(data.directie.forecast.omzetDoel)],
                    [
                      "Getekend",
                      formatEuro(data.directie.forecast.omzetGetekend),
                    ],
                    [
                      "Gefactureerd",
                      formatEuro(data.directie.forecast.omzetGefactureerd),
                    ],
                    [
                      "Betaald",
                      formatEuro(data.directie.forecast.omzetBetaald),
                    ],
                    [
                      "Verwacht einde maand",
                      formatEuro(
                        data.directie.forecast.verwachteOmzetEindeMaand
                      ),
                    ],
                    [
                      "Verwachte brutowinst",
                      data.directie.forecast.verwachteBrutowinst != null
                        ? formatEuro(
                            data.directie.forecast.verwachteBrutowinst
                          )
                        : "Nog geen data",
                    ],
                    [
                      "Nog deals nodig",
                      String(data.directie.forecast.benodigdeDeals),
                    ],
                    [
                      "Nog leads nodig",
                      String(data.directie.forecast.benodigdeLeads),
                    ],
                    [
                      "Nog uitgevoerde afspraken",
                      String(
                        data.directie.forecast.benodigdeUitgevoerdeAfspraken
                      ),
                    ],
                    [
                      "Nog geplande afspraken",
                      String(
                        data.directie.forecast.benodigdeGeplandeAfspraken
                      ),
                    ],
                    [
                      "Benodigd ad-budget",
                      data.directie.forecast.benodigdAdBudget != null
                        ? formatEuro(data.directie.forecast.benodigdAdBudget)
                        : "Nog geen data (CPL)",
                    ],
                    [
                      "Kans op doel",
                      data.directie.forecast.kansPct != null
                        ? `${data.directie.forecast.kansPct}%`
                        : "—",
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-lg border border-line bg-wash/50 px-3 py-2"
                    >
                      <p className="text-[10px] font-semibold uppercase text-muted">
                        {label}
                      </p>
                      <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                {data.directie.forecast.missing.length > 0 && (
                  <p className="mt-3 text-xs text-[#C45A12]">
                    Ontbreekt voor forecast:{" "}
                    {data.directie.forecast.missing.join(" · ")}
                  </p>
                )}
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-wash">
                  <div
                    className="h-full rounded-full bg-green"
                    style={{
                      width: `${Math.min(
                        100,
                        data.directie.forecast.omzetDoel > 0
                          ? (data.directie.forecast.omzetGetekend /
                              data.directie.forecast.omzetDoel) *
                              100
                          : 0
                      )}%`,
                    }}
                  />
                </div>
              </section>
            </>
          )}

          {tab === "marketing" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {data.marketing.kpis.map((k) => (
                  <KpiCard key={k.key} kpi={k} onOpen={openDrill} />
                ))}
              </div>
              <section className="rounded-xl border border-line bg-white p-4">
                <h3 className="font-display text-lg font-semibold">
                  Conversiefunnel
                </h3>
                <div className="mt-3 space-y-2">
                  {data.marketing.funnel.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => openDrill(s.drilldown)}
                      className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-left hover:bg-wash"
                    >
                      <div>
                        <p className="text-sm font-semibold text-ink">
                          {s.label}
                        </p>
                        {s.missing && (
                          <p className="text-[10px] text-[#C45A12]">
                            {s.missing}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs tabular-nums text-muted">
                        <span className="font-semibold text-ink">
                          {s.count}
                        </span>
                        <span>
                          vs vorige:{" "}
                          {s.conversionFromPrev != null
                            ? `${s.conversionFromPrev}%`
                            : "—"}
                        </span>
                        <span>
                          vanaf lead:{" "}
                          {s.conversionFromLead != null
                            ? `${s.conversionFromLead}%`
                            : "—"}
                        </span>
                        <Delta pct={s.deltaPct} />
                      </div>
                    </button>
                  ))}
                </div>
              </section>
              <section className="overflow-x-auto rounded-xl border border-line bg-white p-4">
                <h3 className="font-display text-lg font-semibold">
                  Per leadbron
                </h3>
                <table className="mt-3 w-full min-w-[900px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase text-muted">
                      <th className="py-2 pr-2">Bron</th>
                      <th>Spend</th>
                      <th>Leads</th>
                      <th>CPL</th>
                      <th>Afspr.</th>
                      <th>Deals</th>
                      <th>€/sale</th>
                      <th>Omzet</th>
                      <th>ROAS</th>
                      <th>L→S</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.marketing.byBron.map((r) => (
                      <tr key={r.key} className="border-b border-line/60">
                        <td className="py-2 pr-2 font-medium">{r.label}</td>
                        <td>{formatEuro(r.spend)}</td>
                        <td>{r.leads}</td>
                        <td>
                          {r.cpl != null ? formatEuro(r.cpl) : "—"}
                        </td>
                        <td>{r.afsprakenGepland}</td>
                        <td>{r.deals}</td>
                        <td>
                          {r.kostenPerSale != null
                            ? formatEuro(r.kostenPerSale)
                            : "—"}
                        </td>
                        <td>{formatEuro(r.omzetGetekend)}</td>
                        <td>{r.roas != null ? r.roas : "—"}</td>
                        <td>
                          {r.leadToSale != null ? `${r.leadToSale}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.marketing.byBron.length === 0 && (
                  <p className="mt-2 text-sm text-muted">Nog geen data.</p>
                )}
              </section>
              <section className="overflow-x-auto rounded-xl border border-line bg-white p-4">
                <h3 className="font-display text-lg font-semibold">
                  Per Meta-campagne
                </h3>
                <p className="mt-1 text-xs text-muted">
                  Spend per campagne vereist meta_ad_spend-sync. Totals blijven
                  op account-niveau (geen dubbeltelling).
                </p>
                <table className="mt-3 w-full min-w-[900px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase text-muted">
                      <th className="py-2 pr-2">Campagne</th>
                      <th>Spend</th>
                      <th>Leads</th>
                      <th>CPL</th>
                      <th>Deals</th>
                      <th>Omzet</th>
                      <th>Marge</th>
                      <th>ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.marketing.byCampaign.map((r) => (
                      <tr key={r.key} className="border-b border-line/60">
                        <td className="py-2 pr-2 font-medium">{r.label}</td>
                        <td>{formatEuro(r.spend)}</td>
                        <td>{r.leads}</td>
                        <td>
                          {r.cpl != null ? formatEuro(r.cpl) : "—"}
                        </td>
                        <td>{r.deals}</td>
                        <td>{formatEuro(r.omzetGetekend)}</td>
                        <td>
                          {r.brutomarge != null
                            ? formatEuro(r.brutomarge)
                            : "—"}
                        </td>
                        <td>{r.roas != null ? r.roas : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}

          {tab === "sales" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-line p-3">
                  <p className="text-[10px] font-semibold uppercase text-muted">
                    Vrije slots (4 wkn)
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {data.sales.team.vrijeSlots4Weken}
                  </p>
                </div>
                <div className="rounded-xl border border-line p-3">
                  <p className="text-[10px] font-semibold uppercase text-muted">
                    Benodigde leads
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {data.sales.team.benodigdeLeads4Weken}
                  </p>
                </div>
                <div className="rounded-xl border border-line p-3">
                  <p className="text-[10px] font-semibold uppercase text-muted">
                    Benodigd ad-budget
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {data.sales.team.benodigdBudget4Weken != null
                      ? formatEuro(data.sales.team.benodigdBudget4Weken)
                      : "Nog geen CPL"}
                  </p>
                </div>
                <div className="rounded-xl border border-line p-3">
                  <p className="text-[10px] font-semibold uppercase text-muted">
                    Team show-rate
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {data.sales.team.gemShowRate != null
                      ? `${data.sales.team.gemShowRate}%`
                      : "—"}
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[1100px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-line bg-wash text-[10px] uppercase text-muted">
                      <th className="px-3 py-2">Adviseur</th>
                      <th>Leads</th>
                      <th>Afspr.</th>
                      <th>Show</th>
                      <th>Deals</th>
                      <th>Close</th>
                      <th>L→S</th>
                      <th>AOV</th>
                      <th>Omzet</th>
                      <th>Winst</th>
                      <th>Cap. (vrij)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sales.adviseurs.map((a) => (
                      <tr key={a.id} className="border-b border-line/50">
                        <td className="px-3 py-2 font-semibold">{a.naam}</td>
                        <td>{a.leads}</td>
                        <td>{a.afsprakenGepland}</td>
                        <td>
                          {a.showRate != null ? `${a.showRate}%` : "—"}
                        </td>
                        <td>{a.deals}</td>
                        <td>
                          {a.closingPct != null ? `${a.closingPct}%` : "—"}
                        </td>
                        <td>
                          {a.leadToSale != null ? `${a.leadToSale}%` : "—"}
                        </td>
                        <td>
                          {a.gemOrderwaarde != null
                            ? formatEuro(a.gemOrderwaarde)
                            : "—"}
                        </td>
                        <td>{formatEuro(a.omzetGetekend)}</td>
                        <td>
                          {a.brutowinst != null
                            ? formatEuro(a.brutowinst)
                            : "—"}
                        </td>
                        <td>
                          {a.capacity.map((w) => w.vrij).join(" / ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted">
                Capaciteit: {data.instellingen.slots_per_adviseur_per_week}{" "}
                slots/week tenzij week geblokkeerd in agenda. Reactietijd /
                contact%: nog geen event-tracking → “Nog geen data”.
              </p>
            </>
          )}

          {tab === "orders" && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {data.orders.kpis.map((k) => (
                  <KpiCard key={k.key} kpi={k} onOpen={openDrill} />
                ))}
              </div>
              <section className="rounded-xl border border-line p-4">
                <h3 className="font-display text-lg font-semibold">
                  Risico-omzet (niet als gerealiseerd tellen)
                </h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    [
                      "Zonder financiering OK",
                      data.orders.risico.zonderFinanciering,
                    ],
                    [
                      "Zonder schouw GO",
                      data.orders.risico.zonderSchouwGo,
                    ],
                    [
                      "Zonder installatiedatum",
                      data.orders.risico.zonderInstallatiedatum,
                    ],
                    [
                      "Geïnstalleerd, niet betaald",
                      data.orders.risico.geinstalleerdNietBetaald,
                    ],
                    ["Binnen bedenktijd", data.orders.risico.binnenBedenktijd],
                    ["NO-GO risico", data.orders.risico.noGoRisico],
                  ].map(([label, val]) => (
                    <div
                      key={String(label)}
                      className="rounded-lg border border-line bg-wash/40 px-3 py-2"
                    >
                      <p className="text-[10px] font-semibold uppercase text-muted">
                        {label}
                      </p>
                      <p className="mt-1 font-semibold tabular-nums">
                        {val == null
                          ? "Nog geen data"
                          : formatEuro(Number(val))}
                      </p>
                    </div>
                  ))}
                </div>
                {data.orders.risico.missing.length > 0 && (
                  <p className="mt-2 text-xs text-[#C45A12]">
                    {data.orders.risico.missing.join(" · ")}
                  </p>
                )}
              </section>
              <section className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[800px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-line bg-wash text-[10px] uppercase text-muted">
                      <th className="px-3 py-2">Fase</th>
                      <th>Aantal</th>
                      <th>Orderwaarde</th>
                      <th>Wachttijd</th>
                      <th>Over tijd</th>
                      <th>Volgende actie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.pipeline.map((p) => (
                      <tr
                        key={p.key}
                        className="cursor-pointer border-b border-line/50 hover:bg-wash"
                        onClick={() => openDrill(p.drilldown)}
                      >
                        <td className="px-3 py-2 font-medium">
                          {p.label}
                          {p.missing && (
                            <span className="block text-[10px] text-[#C45A12]">
                              {p.missing}
                            </span>
                          )}
                        </td>
                        <td>{p.count}</td>
                        <td>{formatEuro(p.orderwaarde)}</td>
                        <td>
                          {p.avgWaitDays != null
                            ? `${p.avgWaitDays}d`
                            : "—"}
                        </td>
                        <td>{p.overdueCount}</td>
                        <td>{p.nextAction}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="rounded-xl border border-line p-4">
                <h3 className="font-display text-lg font-semibold">
                  Installatiecapaciteit 8 weken
                </h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
                  {data.orders.capacity8Weken.map((w) => (
                    <div
                      key={w.weekLabel}
                      className={[
                        "rounded-lg border px-2 py-2 text-center text-xs",
                        w.overOnder < 0
                          ? "border-[#C62828]/40 bg-[#FDECEC]"
                          : "border-line bg-wash/40",
                      ].join(" ")}
                    >
                      <p className="font-semibold">{w.weekLabel}</p>
                      <p className="mt-1 tabular-nums">
                        {w.gepland}/{w.beschikbaar}
                      </p>
                      <p className="text-[10px] text-muted">
                        Δ {w.overOnder}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {tab === "finance" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Getekend", data.finance.getekendeOrderwaarde],
                  ["Gefactureerd", data.finance.gefactureerdeOmzet],
                  ["Betaald", data.finance.betaaldeOmzet],
                  ["Nog te factureren", data.finance.nogTeFactureren],
                  ["Openstaand", data.finance.openstaandeFacturen],
                  ["Achterstallig", data.finance.achterstalligeFacturen],
                  ["Verwachte brutowinst", data.finance.verwachteBrutowinst],
                  ["BTW ontvangen", data.finance.btwOntvangen],
                ].map(([label, val]) => (
                  <div
                    key={String(label)}
                    className="rounded-xl border border-line p-3"
                  >
                    <p className="text-[10px] font-semibold uppercase text-muted">
                      {label}
                    </p>
                    <p className="mt-1 text-xl font-bold tabular-nums">
                      {formatEuro(Number(val))}
                    </p>
                  </div>
                ))}
              </div>
              <section className="rounded-xl border border-line p-4">
                <h3 className="font-display text-lg font-semibold">
                  Ouderdom openstaande facturen
                </h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-5">
                  {data.finance.aging.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => openDrill(b.drilldown)}
                      className="rounded-lg border border-line px-3 py-2 text-left hover:bg-wash"
                    >
                      <p className="text-[10px] font-semibold uppercase text-muted">
                        {b.label}
                      </p>
                      <p className="mt-1 font-semibold">
                        {formatEuro(b.bedrag)}
                      </p>
                      <p className="text-[10px] text-muted">{b.count} stuks</p>
                    </button>
                  ))}
                </div>
              </section>
              <section className="rounded-xl border border-line p-4">
                <h3 className="font-display text-lg font-semibold">
                  Cashflowprognose (ontvangsten)
                </h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  {data.finance.cashflow.map((c) => (
                    <div
                      key={c.horizonDays}
                      className="rounded-lg border border-line px-3 py-2"
                    >
                      <p className="text-[10px] font-semibold uppercase text-muted">
                        {c.horizonDays} dagen
                      </p>
                      <p className="mt-1 font-semibold">
                        {formatEuro(c.verwachteOntvangsten)}
                      </p>
                      <p className="text-[10px] text-muted">
                        Eindsaldo:{" "}
                        {c.eindsaldo != null
                          ? formatEuro(c.eindsaldo)
                          : "Nog geen beginsaldo"}
                      </p>
                    </div>
                  ))}
                </div>
                {data.finance.missing.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-[#C45A12]">
                    {data.finance.missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {tab === "instellingen" && (
            <InstellingenForm
              initial={data.instellingen}
              onSaved={() => void load()}
            />
          )}
        </div>
      )}

      <DrilldownDrawer
        open={Boolean(drill)}
        onClose={() => setDrill(null)}
        drillRef={drill}
      />
    </div>
  );
}

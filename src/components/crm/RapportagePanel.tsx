"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GeoRegionMetrics } from "@/lib/rapportage";
import {
  CONVERSIE_PERIOD_LABELS,
  type ConversiePeriod,
} from "@/lib/conversie-period";
import { RapportageMap } from "./RapportageMap";
import { DashboardV2 } from "./DashboardV2";
import { BelConversiePanel } from "./BelConversiePanel";
import { LeadConversiePanel } from "./LeadConversiePanel";
import { SalesManagerPanel } from "./SalesManagerPanel";
import { MarketingPanel } from "./MarketingPanel";
import { FinancialPanel } from "./FinancialPanel";
import { OperationeelRapportagePanel } from "./OperationeelRapportagePanel";
import { LiveRapportagePanel } from "./LiveRapportagePanel";
import { CeoTotaalPanel } from "./CeoTotaalPanel";
import { ManagerInsightsPanel } from "./ManagerInsightsPanel";
import { useCrmSession } from "@/hooks/useCrmSession";

type ViewMode =
  | "ceo"
  | "manager_insights"
  | "dashboard_v2"
  | "live"
  | "operationeel"
  | "bel_conversie"
  | "lead_conversie"
  | "sales"
  | "marketing"
  | "financial"
  | "map";

const ALL_VIEWS: { id: ViewMode; label: string }[] = [
  { id: "ceo", label: "Totaal" },
  { id: "manager_insights", label: "Manager Insights" },
  { id: "dashboard_v2", label: "Dashboard" },
  { id: "live", label: "Live" },
  { id: "operationeel", label: "Operationeel" },
  { id: "bel_conversie", label: "Bellen" },
  { id: "lead_conversie", label: "Leads" },
  { id: "sales", label: "Sales" },
  { id: "marketing", label: "Marketing" },
  { id: "financial", label: "Financieel" },
  { id: "map", label: "Kaart" },
];

export function RapportagePanel() {
  const router = useRouter();
  const { rol } = useCrmSession();
  const views = useMemo(
    () =>
      rol === "beller"
        ? ALL_VIEWS.filter((v) => v.id === "bel_conversie")
        : ALL_VIEWS,
    [rol]
  );
  const [view, setView] = useState<ViewMode>(
    rol === "beller" ? "bel_conversie" : "ceo"
  );

  useEffect(() => {
    if (rol === "beller" && view !== "bel_conversie") {
      setView("bel_conversie");
    }
  }, [rol, view]);
  const [geo, setGeo] = useState<GeoRegionMetrics[]>([]);
  const [geoPeriod, setGeoPeriod] = useState<ConversiePeriod>("all_time");
  const [geoPeriodLabel, setGeoPeriodLabel] = useState(
    CONVERSIE_PERIOD_LABELS.all_time
  );
  const [mapLoading, setMapLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMap = useCallback(async (period: ConversiePeriod) => {
    setMapLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/rapportage?geo_period=${encodeURIComponent(period)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setGeo(data.geo || []);
      setGeoPeriodLabel(
        (data.geoPeriodLabel as string) || CONVERSIE_PERIOD_LABELS[period]
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setMapLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "map") return;
    void loadMap(geoPeriod);
  }, [view, geoPeriod, loadMap]);

  const title =
    view === "ceo"
      ? "Totaal"
      : view === "manager_insights"
        ? "Manager Insights"
        : view === "dashboard_v2"
          ? "Dashboard"
          : view === "live"
            ? "Live"
            : view === "operationeel"
              ? "Operationeel"
              : view === "bel_conversie"
                ? "Bellen"
                : view === "lead_conversie"
                  ? "Leads"
                  : view === "sales"
                    ? "Sales"
                    : view === "marketing"
                      ? "Marketing"
                      : view === "financial"
                        ? "Financieel"
                        : "Kaart";
  const subtitle =
    view === "ceo"
      ? "Marketing · Sales · Callcenter · Projected P&L — één filter voor alles."
      : view === "manager_insights"
        ? "Actiepunten per unit t.o.v. targets — inclusief diagnose regio vs planning."
        : view === "dashboard_v2"
          ? "Stand vs doel: waar staan we, en wat moet er nog bij."
          : view === "live"
            ? "Recente leads · L→A op cohort binnenkomst · wanneer ingepland."
            : view === "operationeel"
              ? "Orders per status · waar staan projecten in de pipeline."
              : view === "bel_conversie"
                ? "Dagoel (vandaag) · periodefilter · team · €10 per netto."
                : view === "lead_conversie"
                  ? "Lead-conversie · periodefilter · bi-weekly leads nodig · CPL per kanaal."
                  : view === "sales"
                    ? "Sales Manager · conversieketen · tijdlijn · kaart per adviseur."
                    : view === "marketing"
                      ? "Meta spend (Amsterdam) · leads uit DB · CAC · ROAS · ROI per campagne."
                      : view === "financial"
                        ? "Cashstand · purchasing · installatie · loon · ads · BTW · commissie."
                        : "Leads per provincie · filter op binnenkomstdatum.";

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-5">
      <div className="border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <p className="font-display text-base font-semibold text-ink">
              {title}
            </p>
            <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1 border border-line p-0.5">
            {views.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={[
                  "px-3 py-1.5 text-xs font-semibold transition",
                  view === id
                    ? "bg-green text-white"
                    : "bg-white text-muted hover:bg-wash",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
            {rol !== "beller" ? (
              <button
                type="button"
                onClick={() => router.push("/?tab=weekmeeting")}
                className="px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-wash"
                title="Naar Weekmeeting"
              >
                Weekmeeting
              </button>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="border-b border-line bg-[#FFF0E6] px-4 py-2 text-sm text-[#C45A12]">
            {error}
          </p>
        ) : null}

        {view === "ceo" ? (
          <div className="bg-wash/40">
            <CeoTotaalPanel />
          </div>
        ) : view === "manager_insights" ? (
          <div className="bg-wash/40 px-4 py-5 sm:px-5">
            <ManagerInsightsPanel />
          </div>
        ) : view === "dashboard_v2" ? (
          <div className="bg-wash/40 px-4 py-5 sm:px-5">
            <DashboardV2 />
          </div>
        ) : view === "live" ? (
          <div className="bg-wash/40 px-4 py-5 sm:px-5">
            <LiveRapportagePanel />
          </div>
        ) : view === "operationeel" ? (
          <div className="bg-wash/40">
            <OperationeelRapportagePanel />
          </div>
        ) : view === "bel_conversie" ? (
          <div className="bg-wash/40 px-4 py-5 sm:px-5">
            <BelConversiePanel />
          </div>
        ) : view === "lead_conversie" ? (
          <div className="bg-wash/40 px-4 py-5 sm:px-5">
            <LeadConversiePanel />
          </div>
        ) : view === "sales" ? (
          <div className="bg-wash/30">
            <SalesManagerPanel />
          </div>
        ) : view === "marketing" ? (
          <div className="bg-wash/40 px-4 py-5 sm:px-5">
            <MarketingPanel />
          </div>
        ) : view === "financial" ? (
          <div className="bg-wash/40">
            <FinancialPanel />
          </div>
        ) : mapLoading ? (
          <p className="px-4 py-10 text-center text-sm text-muted">Laden…</p>
        ) : (
          <RapportageMap
            regions={geo}
            period={geoPeriod}
            periodLabel={geoPeriodLabel}
            onPeriodChange={setGeoPeriod}
          />
        )}
      </div>
    </div>
  );
}

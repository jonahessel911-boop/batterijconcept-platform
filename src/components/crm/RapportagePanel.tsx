"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";

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
  const searchParams = useSearchParams();
  const { rol } = useCrmSession();
  const viewFromQuery = useRef(false);
  const views = useMemo(
    () =>
      rol === "beller"
        ? ALL_VIEWS.filter((v) => v.id === "bel_conversie")
        : ALL_VIEWS,
    [rol]
  );
  const [view, setView] = useState<ViewMode>(() => {
    if (searchParams.get("view") === "marketing") return "marketing";
    return rol === "beller" ? "bel_conversie" : "ceo";
  });

  useEffect(() => {
    if (rol === "beller" && view !== "bel_conversie") {
      setView("bel_conversie");
    }
  }, [rol, view]);

  useEffect(() => {
    if (viewFromQuery.current || !rol || rol === "beller") return;
    if (searchParams.get("view") === "marketing") {
      viewFromQuery.current = true;
      setView("marketing");
    }
  }, [rol, searchParams]);
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
    <TooltipProvider>
    <div className="min-w-0 px-3 py-4 sm:px-6 sm:py-5">
      <div className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
          <div>
            <p className="font-display text-base font-semibold text-ink">
              {title}
            </p>
            <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
          </div>
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <Tabs
              value={view}
              onValueChange={(id) => setView(id as ViewMode)}
              className="min-w-0"
            >
              <TabsList>
                {views.map(({ id, label }) => (
                  <TabsTrigger key={id} value={id}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {rol !== "beller" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => router.push("/?tab=weekmeeting")}
                title="Naar Weekmeeting"
              >
                Weekmeeting
              </Button>
            ) : null}
          </div>
        </div>
        <Separator />

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
          <div className="space-y-3 px-4 py-8">
            <Skeleton className="mx-auto h-4 w-40" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
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
    </TooltipProvider>
  );
}

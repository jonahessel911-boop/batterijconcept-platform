"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Target } from "lucide-react";
import type { RecruitmentKpiRoleRow } from "@/lib/recruitment-kpi";
import { RECRUITMENT_KPI_DEFAULTS } from "@/lib/recruitment-kpi";
import { formatEuro } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const LS_TARGET = "recruitment-kpi-target-sales";
const LS_SETTER = "recruitment-kpi-setter-calls";
const LS_CPH = "recruitment-kpi-target-cph-adviseur";

type KpiResponse = {
  ok?: boolean;
  error?: string;
  period?: { label: string; startYmd: string; endYmd: string; days: number };
  inputs?: {
    conv_gelopen_sale_pct: number | null;
    gelopen: number;
    sales: number;
    leads_in: number;
    wf_doorgestuurd: number;
  };
  rows?: RecruitmentKpiRoleRow[];
};

type RolSpendRow = {
  rol: string;
  spend: number;
  leads: number;
  hires: number;
  cpl: number | null;
  cph: number | null;
};

type CphState = {
  since: string;
  until: string;
  spend: number;
  hires: number;
  cph: number | null;
  totalSpend: number;
  totalHires: number;
  totalCph: number | null;
  metaOk: boolean;
  configured: boolean;
  metaError: string | null;
};

function readLsNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function amsterdamYmd(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
}

/** Lager CPH = beter. 100% als ≤ doel, daarna lineair omlaag. */
function cphProgressPct(cph: number | null, target: number): number {
  if (cph == null || !(target > 0)) return 0;
  if (cph <= target) return 100;
  return Math.max(0, Math.min(100, Math.round((target / cph) * 100)));
}

export function RecruitmentKpisView() {
  const [targetSales, setTargetSales] = useState<number>(
    RECRUITMENT_KPI_DEFAULTS.targetSalesPerWeek
  );
  const [setterCalls, setSetterCalls] = useState<number>(
    RECRUITMENT_KPI_DEFAULTS.setterCallsPerDay
  );
  const [targetCph, setTargetCph] = useState<number>(
    RECRUITMENT_KPI_DEFAULTS.targetCphAdviseur
  );
  const [loading, setLoading] = useState(true);
  const [cphLoading, setCphLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cphError, setCphError] = useState<string | null>(null);
  const [periodLabel, setPeriodLabel] = useState("Afgelopen 14 dagen");
  const [inputs, setInputs] = useState<KpiResponse["inputs"]>(undefined);
  const [rows, setRows] = useState<RecruitmentKpiRoleRow[]>([]);
  const [cph, setCph] = useState<CphState | null>(null);

  useEffect(() => {
    setTargetSales(
      readLsNumber(LS_TARGET, RECRUITMENT_KPI_DEFAULTS.targetSalesPerWeek)
    );
    setSetterCalls(
      readLsNumber(LS_SETTER, RECRUITMENT_KPI_DEFAULTS.setterCallsPerDay)
    );
    setTargetCph(
      readLsNumber(LS_CPH, RECRUITMENT_KPI_DEFAULTS.targetCphAdviseur)
    );
  }, []);

  const loadStaffing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        target_sales: String(targetSales),
        setter_calls_per_day: String(setterCalls),
      });
      const res = await fetch(`/api/instroom/kpis?${qs}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as KpiResponse;
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setPeriodLabel(data.period?.label || "Afgelopen 14 dagen");
      setInputs(data.inputs);
      setRows(data.rows || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [targetSales, setterCalls]);

  const loadCph = useCallback(async () => {
    setCphLoading(true);
    setCphError(null);
    try {
      const until = new Date();
      const since = new Date();
      since.setDate(
        until.getDate() - (RECRUITMENT_KPI_DEFAULTS.cphLookbackDays - 1)
      );
      const qs = new URLSearchParams({
        since: amsterdamYmd(since),
        until: amsterdamYmd(until),
      });
      const res = await fetch(`/api/instroom/marketing?${qs}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        since?: string;
        until?: string;
        spend?: number;
        hires?: number;
        cph?: number | null;
        configured?: boolean;
        metaOk?: boolean;
        metaError?: string | null;
        byRol?: RolSpendRow[];
      };
      if (!res.ok) throw new Error(data.error || "Ad spend laden mislukt");

      const adviseur =
        (data.byRol || []).find((r) => r.rol === "adviseur_sales") || null;
      const spend = adviseur?.spend ?? 0;
      const hires = adviseur?.hires ?? 0;
      const cphVal =
        adviseur?.cph ??
        (hires > 0 ? Math.round((spend / hires) * 100) / 100 : null);

      setCph({
        since: data.since || qs.get("since") || "",
        until: data.until || qs.get("until") || "",
        spend,
        hires,
        cph: cphVal,
        totalSpend: data.spend || 0,
        totalHires: data.hires || 0,
        totalCph: data.cph ?? null,
        metaOk: data.metaOk !== false,
        configured: data.configured !== false,
        metaError: data.metaError || null,
      });
    } catch (e) {
      setCphError(e instanceof Error ? e.message : "Ad spend laden mislukt");
    } finally {
      setCphLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStaffing();
  }, [loadStaffing]);

  useEffect(() => {
    void loadCph();
  }, [loadCph]);

  function persistAndReload() {
    window.localStorage.setItem(LS_TARGET, String(targetSales));
    window.localStorage.setItem(LS_SETTER, String(setterCalls));
    window.localStorage.setItem(LS_CPH, String(targetCph));
    void loadStaffing();
    void loadCph();
  }

  function refreshAll() {
    void loadStaffing();
    void loadCph();
  }

  const cphPct = cphProgressPct(cph?.cph ?? null, targetCph);
  const onTarget =
    cph?.cph != null && cph.cph > 0 ? cph.cph <= targetCph : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">KPI’s recruitment</p>
          <p className="text-xs text-muted">
            Cost per hire (ad spend) + staffing op basis van gelopen→sale (
            {periodLabel.toLowerCase()}).
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || cphLoading}
          onClick={refreshAll}
        >
          <RefreshCw
            className={cn(
              "size-4",
              (loading || cphLoading) && "animate-spin"
            )}
          />
          Vernieuwen
        </Button>
      </div>

      {/* Primaire KPI: cost per hire adviseur */}
      <Card className="rounded-xl shadow-none ring-1 ring-line">
        <CardHeader className="px-4 py-3 sm:px-5">
          <CardTitle className="font-display text-lg tracking-tight text-ink">
            Cost per hire · Adviseur
          </CardTitle>
          <CardDescription className="text-xs">
            BANEN-spend ({cph ? `${cph.since} t/m ${cph.until}` : "periode"}) ÷
            alle aangenomen met huidige functie adviseur/ZZP-verkoper · doel{" "}
            {formatEuro(targetCph)}/hire
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4 sm:px-5">
          {cphError ? (
            <Alert variant="destructive">
              <AlertDescription>{cphError}</AlertDescription>
            </Alert>
          ) : null}
          {!cph?.configured ? (
            <p className="text-sm text-muted">
              Meta BANEN-account nog niet gekoppeld (META_ADS_ACCESS_TOKEN).
            </p>
          ) : cphLoading && !cph ? (
            <p className="text-sm text-muted">Ad spend laden…</p>
          ) : cph ? (
            <>
              {cph.metaError ? (
                <p className="text-xs text-[#C45A12]">{cph.metaError}</p>
              ) : null}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Actueel
                  </p>
                  <p className="font-display text-3xl font-semibold tabular-nums text-ink">
                    {cph.cph != null ? formatEuro(cph.cph) : "—"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {formatEuro(cph.spend)} spend · {cph.hires} hire
                    {cph.hires === 1 ? "" : "s"} adviseur
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Doel
                  </p>
                  <p className="text-xl font-semibold tabular-nums text-ink">
                    {formatEuro(targetCph)}
                  </p>
                  {onTarget == null ? (
                    <p className="text-xs text-muted">Nog geen hires</p>
                  ) : onTarget ? (
                    <p className="text-xs font-semibold text-green-deeper">
                      Op doel
                    </p>
                  ) : (
                    <p className="text-xs font-semibold text-[#C45A12]">
                      Boven doel (+
                      {formatEuro((cph.cph || 0) - targetCph)})
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted">
                    Eerste KPI: €{targetCph} per hire adviseur
                  </p>
                  <p className="text-xs tabular-nums text-muted">{cphPct}%</p>
                </div>
                <Progress value={cphPct} className="w-full">
                  <ProgressLabel className="sr-only">
                    Cost per hire adviseur
                  </ProgressLabel>
                </Progress>
              </div>
              {cph.totalSpend > 0 && cph.spend === 0 ? (
                <p className="text-[11px] text-muted">
                  Tip: koppel BANEN-campagnes aan vacature «Adviseur sales»
                  (Marketing) zodat spend op deze KPI landt. Totaal nu{" "}
                  {formatEuro(cph.totalSpend)}
                  {cph.totalCph != null
                    ? ` · overall CPH ${formatEuro(cph.totalCph)}`
                    : ""}
                  .
                </p>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-none ring-1 ring-line">
        <CardHeader className="px-4 py-3 sm:px-5">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Target className="size-4 text-muted" />
            Rekeninputs
          </CardTitle>
          <CardDescription className="text-xs">
            Pas doelen aan; staffing gebruikt 14 dagen, CPH de laatste{" "}
            {RECRUITMENT_KPI_DEFAULTS.cphLookbackDays} dagen.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3 px-4 pb-4 sm:px-5">
          <div className="space-y-1.5">
            <Label htmlFor="kpi-cph">Doel CPH adviseur (€)</Label>
            <Input
              id="kpi-cph"
              type="number"
              min={1}
              className="w-36"
              value={targetCph}
              onChange={(e) => setTargetCph(Number(e.target.value) || 1)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kpi-target">Sales-doel / week</Label>
            <Input
              id="kpi-target"
              type="number"
              min={1}
              className="w-32"
              value={targetSales}
              onChange={(e) => setTargetSales(Number(e.target.value) || 1)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kpi-setter">Setter belcapaciteit / dag</Label>
            <Input
              id="kpi-setter"
              type="number"
              min={1}
              className="w-40"
              value={setterCalls}
              onChange={(e) => setSetterCalls(Number(e.target.value) || 1)}
            />
          </div>
          <Button type="button" size="sm" onClick={persistAndReload}>
            Toepassen
          </Button>
          {inputs ? (
            <p className="w-full text-[11px] text-muted">
              14d: {inputs.gelopen} gelopen · {inputs.sales} sales
              {inputs.conv_gelopen_sale_pct != null
                ? ` (${inputs.conv_gelopen_sale_pct}%)`
                : ""}{" "}
              · {inputs.leads_in} leads · {inputs.wf_doorgestuurd} WF
              doorgestuurd
            </p>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div>
        <p className="mb-2 text-sm font-semibold text-ink">Staffing</p>
        {loading && rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">Laden…</p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <Card
                key={row.id}
                className="rounded-xl shadow-none ring-1 ring-line"
              >
                <CardContent className="space-y-3 px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="font-display text-lg tracking-tight text-ink">
                        {row.label}
                      </p>
                      <p className="text-xs text-muted">{row.detail}</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-ink">
                      {row.have} / {row.needed}
                      {row.gap > 0 ? (
                        <span className="ml-2 text-xs font-medium text-[#C45A12]">
                          −{row.gap}
                        </span>
                      ) : (
                        <span className="ml-2 text-xs font-medium text-green-deeper">
                          ok
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted">{row.hint}</p>
                      <p className="text-xs tabular-nums text-muted">
                        {row.progressPct}%
                      </p>
                    </div>
                    <Progress value={row.progressPct} className="w-full">
                      <ProgressLabel className="sr-only">
                        {row.label}
                      </ProgressLabel>
                    </Progress>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

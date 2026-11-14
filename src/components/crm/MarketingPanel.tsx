"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Image from "next/image";
import { AMSTERDAM_TZ, formatEuro } from "@/lib/format";
import type {
  MarketingMetrics,
  MarketingMonthBucket,
  MarketingSourceRow,
  MarketingSourceSlice,
  MarketingWeekBucket,
} from "@/lib/marketing-rapportage";
import { buildChannelsFromCampaigns } from "@/lib/marketing-rapportage";
import { SourceBrandMark } from "./SourceBrandMark";
import { tiktokAuthUrl } from "@/lib/tiktok-ads";
import { MarketingTrendChart } from "./MarketingTrendChart";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableHeader } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  agendaWeekJumpOptions,
  formatSchouwWeekLabel,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import {
  conversieMonthRangeContaining,
  todayConversieYmd,
} from "@/lib/conversie-period";
import { addDays, addMonths, addWeeks } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

type MarketingData = {
  startYmd: string;
  endYmd: string;
  periodLabel: string;
  totals: MarketingMetrics;
  series: MarketingWeekBucket[];
  months: MarketingMonthBucket[];
  sources?: MarketingSourceRow[];
  bySource?: MarketingSourceSlice[];
  metaConfigured: boolean;
  tiktokConfigured?: boolean;
  tiktokError?: string | null;
  lastSyncAt: string | null;
  metaMissing?: string[];
  metaCampaigns?: string[];
};

type RangeMode = "weeks" | "month";
type SourceFilter = "all" | string;

function fmtRoas(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toLocaleString("nl-NL", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}x`;
}

function num(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL");
}

/** % t.o.v. vorige periode; null als niet berekenbaar. */
type ChartBucket = MarketingMetrics & {
  key: string;
  label: string;
  shortLabel: string;
  /** Cumulatieve leads t/m deze bucket (dag-drill: schema) */
  cumLeads?: number;
  /** Cumulatief leads-doel t/m deze bucket (lineair over de week) */
  cumLeadsNodig?: number;
};

function shiftMonthYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = addMonths(new Date(y, m - 1, 1, 12, 0, 0), delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function MetaMark({ className = "h-3.5 w-5" }: { className?: string }) {
  return (
    <Image
      src="/brands/meta.svg"
      alt="Meta"
      width={20}
      height={14}
      className={className}
      unoptimized
    />
  );
}

function ChannelLogos({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <SourceBrandMark source="Meta" className={className} />
      <SourceBrandMark source="TikTok" className={className} />
    </span>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="shadow-none">
      <CardHeader className="px-3 pt-3 pb-0">
        <CardDescription className="text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
      </CardHeader>
      <p className="px-3 pt-1 pb-3 font-display text-xl font-semibold tabular-nums text-ink sm:text-2xl">
        {value}
      </p>
      {hint ? (
        <p className="px-3 pb-3 text-[11px] text-muted">{hint}</p>
      ) : null}
    </Card>
  );
}

const sheetCell =
  "border-b border-line px-2.5 py-2 text-[12px] tabular-nums text-ink";
const sheetHead =
  "border-b border-line bg-wash/80 px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-muted";
const sheetTotal =
  "border-b border-line bg-green-soft/70 px-2.5 py-2.5 text-[12px] font-semibold tabular-nums text-ink";
const sheetSelected =
  "border-b border-line bg-green-soft/50 px-2.5 py-2 text-[12px] font-semibold tabular-nums text-ink";
const sheetSelectedLabel =
  "border-b border-line bg-green-soft/50 px-2.5 py-2 pl-5 text-left font-semibold text-ink shadow-[inset_3px_0_0_0_#0a4727]";

function MetricsCells({
  m,
  tone = "cell",
}: {
  m: MarketingMetrics;
  tone?: "cell" | "total" | "week" | "selected";
}) {
  const base =
    tone === "total"
      ? sheetTotal
      : tone === "selected"
        ? sheetSelected
        : tone === "week"
          ? `${sheetCell} bg-[#FAFBFA]`
          : sheetCell;
  return (
    <>
      <td className={`${base} whitespace-nowrap text-right`}>
        {formatEuro(m.spend)}
      </td>
      <td className={`${base} whitespace-nowrap text-right`}>{num(m.leads)}</td>
      <td className={`${base} hidden whitespace-nowrap text-right text-muted md:table-cell`}>
        {m.cpl != null ? formatEuro(m.cpl) : "—"}
      </td>
      <td className={`${base} whitespace-nowrap text-right`}>
        {m.leadToAppt != null
          ? `${m.leadToAppt.toLocaleString("nl-NL", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}%`
          : "—"}
      </td>
      <td className={`${base} hidden whitespace-nowrap text-right md:table-cell`}>
        {num(m.afspraken)}
      </td>
      <td className={`${base} hidden whitespace-nowrap text-right text-muted md:table-cell`}>
        {m.cpa != null ? formatEuro(m.cpa) : "—"}
      </td>
      <td className={`${base} whitespace-nowrap text-right`}>{num(m.deals)}</td>
      <td className={`${base} hidden whitespace-nowrap text-right text-muted md:table-cell`}>
        {m.cac != null ? formatEuro(m.cac) : "—"}
      </td>
      <td className={`${base} whitespace-nowrap text-right`}>
        {formatEuro(m.omzet)}
      </td>
      <td className={`${base} hidden whitespace-nowrap text-right text-muted md:table-cell`}>
        {m.rpa != null ? formatEuro(m.rpa) : "—"}
      </td>
      <td
        className={`${base} hidden whitespace-nowrap text-right text-green-dark md:table-cell`}
      >
        {fmtRoas(m.roas)}
      </td>
    </>
  );
}

const METRIC_HEADERS = (
  <>
    <th className={sheetHead}>Spend</th>
    <th className={sheetHead}>Leads</th>
    <th className={`${sheetHead} hidden md:table-cell`}>CPL</th>
    <th
      className={sheetHead}
      title="Van de leads die in deze periode bij deze campagne of ad binnenkwamen: aandeel met een huisbezoek."
    >
      L→A
    </th>
    <th className={`${sheetHead} hidden md:table-cell`}>Afspr.</th>
    <th className={`${sheetHead} hidden md:table-cell`}>CPA</th>
    <th className={sheetHead}>Deals</th>
    <th className={`${sheetHead} hidden md:table-cell`}>CPD</th>
    <th className={sheetHead}>Omzet</th>
    <th className={`${sheetHead} hidden md:table-cell`}>RPA</th>
    <th className={`${sheetHead} hidden md:table-cell`}>ROAS</th>
  </>
);

export type MarketingPanelRangeProps = {
  rangeMode?: RangeMode;
  rangeWeekKey?: string;
  rangeMonthYm?: string;
  hideRangeControls?: boolean;
};

export function MarketingPanel({
  rangeMode,
  rangeWeekKey,
  rangeMonthYm,
  hideRangeControls = false,
}: MarketingPanelRangeProps = {}) {
  const today = todayConversieYmd();
  const [localMode, setLocalMode] = useState<RangeMode>("weeks");
  const [localWeekKey, setLocalWeekKey] = useState(() => {
    const w = schouwWeekFromDate(new Date(`${today}T12:00:00`));
    return schouwWeekValue(w.jaar, w.week);
  });
  const [localMonthYm, setLocalMonthYm] = useState(today.slice(0, 7));
  const mode = rangeMode ?? localMode;
  const weekKey = rangeWeekKey ?? localWeekKey;
  const monthYm = rangeMonthYm ?? localMonthYm;
  const setMode = setLocalMode;
  const setWeekKey = setLocalWeekKey;
  const setMonthYm = setLocalMonthYm;
  const [data, setData] = useState<MarketingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set());
  /** Week-key waarnaar is ingezoomd (dag-breakdown); null = weekoverzicht */
  const [drillWeekKey, setDrillWeekKey] = useState<string | null>(null);
  /** Alles = totalen; anders filter op bron (zelfde KPI’s + grafiek). */
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  /** KPI-focus binnen geladen maandreeks (klik op staaf). */
  const [focusMonthYm, setFocusMonthYm] = useState(today.slice(0, 7));
  /** Uitgeklapte campagnes: `${weekKey}::${source}::${campaignKey}` */
  const [openCampaigns, setOpenCampaigns] = useState<Set<string>>(new Set());
  /** Uitgeklapte channel-groepen: `${weekKey}::social|native|search` */
  const [openChannels, setOpenChannels] = useState<Set<string>>(new Set());
  /** Uitgeklapte platforms: `${weekKey}::${source}` */
  const [openPlatforms, setOpenPlatforms] = useState<Set<string>>(new Set());

  const weekOptions = useMemo(() => {
    const base = agendaWeekJumpOptions(26, 2);
    if (weekKey && !base.some((o) => o.value === weekKey)) {
      const p = parseSchouwWeekValue(weekKey);
      if (p) {
        return [
          {
            value: weekKey,
            label: formatSchouwWeekLabel(p.jaar, p.week),
            jaar: p.jaar,
            week: p.week,
          },
          ...base,
        ];
      }
    }
    return base;
  }, [weekKey]);

  const load = useCallback(async (opts?: { sync?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      const todayYmd = todayConversieYmd();
      if (mode === "month") {
        // 6 maanden t/m geselecteerde maand → grafiek per maand + MoM %
        const startYm = shiftMonthYm(monthYm, -5);
        const from = conversieMonthRangeContaining(`${startYm}-01`).startYmd;
        let to = conversieMonthRangeContaining(`${monthYm}-01`).endYmd;
        if (to > todayYmd) to = todayYmd;
        qs.set("from", from);
        qs.set("to", to);
      } else {
        const parsed = parseSchouwWeekValue(weekKey);
        if (parsed) {
          const mon = String(
            schouwWeekToMondayIso(parsed.jaar, parsed.week)
          ).slice(0, 10);
          const [y, m, d] = mon.split("-").map(Number);
          const monNoon = fromZonedTime(
            new Date(y, m - 1, d, 12, 0, 0),
            AMSTERDAM_TZ
          );
          const startYmd = formatInTimeZone(
            addWeeks(monNoon, -11),
            AMSTERDAM_TZ,
            "yyyy-MM-dd"
          );
          let endYmd = formatInTimeZone(
            addDays(monNoon, 6),
            AMSTERDAM_TZ,
            "yyyy-MM-dd"
          );
          if (endYmd > todayYmd) endYmd = todayYmd;
          qs.set("from", startYmd);
          qs.set("to", endYmd);
        }
      }
      if (opts?.sync) qs.set("sync", "1");
      const res = await fetch(`/api/rapportage/marketing?${qs}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Laden mislukt"
        );
      }
      const payload = json as MarketingData;
      setData(payload);
      if (mode === "month") {
        const focusMonth =
          payload.months.find((m) => m.monthKey === monthYm) ||
          payload.months[0];
        if (focusMonth?.monthKey) {
          setOpenMonths(new Set([focusMonth.monthKey]));
          setOpenWeeks(new Set());
          setFocusMonthYm(focusMonth.monthKey);
        }
      } else {
        const focusMonth =
          payload.months.find((m) =>
            m.weeks.some((w) => w.weekKey === weekKey)
          ) || payload.months[payload.months.length - 1];
        if (focusMonth?.monthKey) {
          setOpenMonths(new Set([focusMonth.monthKey]));
          const openKey =
            focusMonth.weeks.find((w) => w.weekKey === weekKey)?.weekKey ||
            focusMonth.weeks[focusMonth.weeks.length - 1]?.weekKey;
          setOpenWeeks(openKey ? new Set([openKey]) : new Set());
        }
      }
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [mode, monthYm, weekKey]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleMonth(key: string) {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleWeek(key: string) {
    setOpenWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        // Bij openen week: Social/Native/Search + platforms direct uitklappen
        const week =
          data?.months
            .flatMap((m) => m.weeks)
            .find((w) => w.weekKey === key) ||
          data?.series.find((w) => w.weekKey === key);
        const channels =
          week?.channels?.length
            ? week.channels
            : buildChannelsFromCampaigns(week?.campaigns || []);
        setOpenChannels((chs) => {
          const n = new Set(chs);
          for (const ch of channels) {
            n.add(channelRowKey(key, ch.key));
          }
          return n;
        });
        setOpenPlatforms((pls) => {
          const n = new Set(pls);
          for (const ch of channels) {
            for (const pl of ch.platforms) {
              n.add(platformRowKey(key, pl.key));
            }
          }
          return n;
        });
      }
      return next;
    });
  }

  function toggleKey(setter: typeof setOpenCampaigns, key: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function channelRowKey(weekKey: string, channelKey: string): string {
    return `${weekKey}::ch::${channelKey}`;
  }
  function platformRowKey(weekKey: string, source: string): string {
    return `${weekKey}::pl::${source}`;
  }
  function campaignRowKey(
    weekKey: string,
    source: string,
    campKey: string
  ): string {
    return `${weekKey}::camp::${source}::${campKey}`;
  }

  const activeSlice = useMemo(() => {
    if (!data || sourceFilter === "all") return null;
    return (
      data.bySource?.find((s) => s.source === sourceFilter) ?? null
    );
  }, [data, sourceFilter]);

  const viewSeries = activeSlice?.series ?? data?.series ?? [];
  const viewMonths = activeSlice?.months ?? data?.months ?? [];
  const viewTotals = activeSlice?.totals ?? data?.totals ?? null;

  /** KPI’s: geselecteerde maand of totale weekreeks (van actieve bron). */
  const t = useMemo(() => {
    if (!viewTotals) return null;
    if (mode === "month") {
      const m =
        viewMonths.find((x) => x.monthKey === focusMonthYm) ||
        viewMonths.find((x) => x.monthKey === monthYm);
      return m ?? viewTotals;
    }
    return viewTotals;
  }, [viewTotals, viewMonths, mode, monthYm, focusMonthYm]);

  const drillWeek = useMemo(() => {
    if (!drillWeekKey || mode !== "weeks") return null;
    return viewSeries.find((w) => w.weekKey === drillWeekKey) ?? null;
  }, [viewSeries, drillWeekKey, mode]);

  const chartBuckets: ChartBucket[] = useMemo(() => {
    if (!data) return [];
    if (mode === "month") {
      const months = [...viewMonths]
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        .map((m) => ({
          key: m.monthKey,
          label: m.label,
          shortLabel: (() => {
            const [y, mo] = m.monthKey.split("-");
            const names = [
              "jan",
              "feb",
              "mrt",
              "apr",
              "mei",
              "jun",
              "jul",
              "aug",
              "sep",
              "okt",
              "nov",
              "dec",
            ];
            const idx = Number(mo) - 1;
            return `${names[idx] ?? mo}’${y.slice(2)}`;
          })(),
          spend: m.spend,
          leads: m.leads,
          afspraken: m.afspraken,
          deals: m.deals,
          omzet: m.omzet,
          cpl: m.cpl,
          leadToAppt: m.leadToAppt,
          cohortLeads: m.cohortLeads,
          appointedLeads: m.appointedLeads,
          cpa: m.cpa,
          cac: m.cac,
          rpa: m.rpa,
          roas: m.roas,
          roi: m.roi,
          leadsNodig: m.leadsNodig ?? null,
        }));
      const first = months.findIndex(
        (m) => m.spend > 0 || m.leads > 0 || m.afspraken > 0 || m.deals > 0
      );
      return first > 0 ? months.slice(first) : months;
    }

    // Dag-drill: alle dagen van de aangeklikte week + cumulatief schema
    if (drillWeek) {
      const weekNeed = drillWeek.leadsNodig ?? 0;
      const nDays = 7;
      let cumLeads = 0;
      return (drillWeek.days || []).map((d, i) => {
        cumLeads += d.leads;
        const cumLeadsNodig =
          weekNeed > 0
            ? Math.round((weekNeed * (i + 1)) / nDays)
            : d.leadsNodig ?? null;
        const dayParts = d.label.split(/\s+/);
        const shortLabel =
          dayParts.length >= 2
            ? `${dayParts[0].replace(/\.$/, "")} ${dayParts[1]}`
            : d.dayKey.slice(8);
        return {
          key: d.dayKey,
          label: d.label,
          shortLabel,
          spend: d.spend,
          leads: d.leads,
          afspraken: d.afspraken,
          deals: d.deals,
          omzet: d.omzet,
          cpl: d.cpl,
          leadToAppt: d.leadToAppt,
          cohortLeads: d.cohortLeads,
          appointedLeads: d.appointedLeads,
          cpa: d.cpa,
          cac: d.cac,
          rpa: d.rpa,
          roas: d.roas,
          roi: d.roi,
          leadsNodig: d.leadsNodig ?? null,
          cumLeads,
          cumLeadsNodig: cumLeadsNodig ?? undefined,
        };
      });
    }

    // Weekview: afgelopen 12 weken, start bij eerste week mét data
    const weeks = viewSeries.map((w) => ({
      key: w.weekKey,
      label: w.label,
      shortLabel: w.weekKey.replace(/^\d{4}-/, "") || w.weekKey,
      spend: w.spend,
      leads: w.leads,
      afspraken: w.afspraken,
      deals: w.deals,
      omzet: w.omzet,
      cpl: w.cpl,
      leadToAppt: w.leadToAppt,
      cohortLeads: w.cohortLeads,
      appointedLeads: w.appointedLeads,
      cpa: w.cpa,
      cac: w.cac,
      rpa: w.rpa,
      roas: w.roas,
      roi: w.roi,
      leadsNodig: w.leadsNodig ?? null,
    }));
    const first = weeks.findIndex(
      (w) => w.spend > 0 || w.leads > 0 || w.afspraken > 0 || w.deals > 0
    );
    return first > 0 ? weeks.slice(first) : weeks;
  }, [data, mode, drillWeek, viewMonths, viewSeries]);

  const compareLabel = drillWeek
    ? "vorige dag"
    : mode === "month"
      ? "vorige maand"
      : "vorige week";
  const sourceTitle =
    sourceFilter === "all" ? null : sourceFilter;
  const chartTitle = [
    drillWeek
      ? drillWeek.label
      : mode === "month"
        ? "Per maand"
        : "Per week",
    sourceTitle,
  ]
    .filter(Boolean)
    .join(" · ");

  const sourceTabs = useMemo(() => {
    const rows = (data?.sources || []).filter((s) => s.source !== "Native");
    return rows;
  }, [data?.sources]);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
            <ChannelLogos className="h-4 w-4" />
            Marketing
          </p>
          {data?.periodLabel ? (
            <p className="mt-0.5 text-xs text-muted">{data.periodLabel}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {!hideRangeControls ? (
            <>
              <Tabs
                value={mode}
                onValueChange={(id) => {
                  const next = id as RangeMode;
                  setMode(next);
                  setDrillWeekKey(null);
                  if (next === "month") setFocusMonthYm(monthYm);
                }}
              >
                <TabsList className="w-auto">
                  <TabsTrigger value="weeks">Week</TabsTrigger>
                  <TabsTrigger value="month">Maand</TabsTrigger>
                </TabsList>
              </Tabs>
              {mode === "month" ? (
                <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Maand
                  <Input
                    type="month"
                    value={monthYm}
                    onChange={(e) => {
                      const next = e.target.value || today.slice(0, 7);
                      setMonthYm(next);
                      setFocusMonthYm(next);
                      setDrillWeekKey(null);
                    }}
                    className="h-8 w-auto bg-white text-sm font-medium"
                  />
                </label>
              ) : (
                <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Eindweek
                  <NativeSelect
                    value={weekKey}
                    onChange={(e) => {
                      setWeekKey(e.target.value);
                      setDrillWeekKey(null);
                    }}
                    className="min-w-[14rem] bg-white"
                  >
                    {weekOptions.map((o) => (
                      <NativeSelectOption key={o.value} value={o.value}>
                        {o.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              )}
            </>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || syncing}
                  onClick={() => {
                    setSyncing(true);
                    void load({ sync: true });
                  }}
                />
              }
            >
              {syncing ? "Sync…" : "Meta sync"}
            </TooltipTrigger>
            <TooltipContent>Meta spend syncen voor deze periode</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {error}{" "}
            <button
              type="button"
              onClick={() => void load()}
              className="font-semibold underline"
            >
              Opnieuw
            </button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!data?.metaConfigured ? (
        <Alert>
          <AlertDescription className="text-xs">
          <span className="mr-1.5 inline-flex align-middle">
            <SourceBrandMark source="Meta" className="h-3.5 w-5" />
          </span>
          Meta Ads niet geconfigureerd
          {data?.metaMissing?.length
            ? ` (${data.metaMissing.join(", ")})`
            : ""}
          . Spend blijft 0 tot sync + env kloppen.
          </AlertDescription>
        </Alert>
      ) : null}

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-10">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-[4.5rem] rounded-xl bg-white" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={sourceFilter === "all" ? "default" : "outline"}
              onClick={() => {
                setSourceFilter("all");
                setDrillWeekKey(null);
              }}
            >
              Alles
            </Button>
            {sourceTabs.map((row) => {
              const active = sourceFilter === row.source;
              return (
                <Button
                  key={row.source}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => {
                    setSourceFilter(row.source);
                    setDrillWeekKey(null);
                  }}
                >
                  <SourceBrandMark
                    source={row.source}
                    className={
                      active
                        ? "h-3.5 w-3.5 brightness-0 invert"
                        : "h-3.5 w-3.5"
                    }
                  />
                  {row.source}
                  <Badge
                    variant={active ? "default" : "secondary"}
                    className={active ? "bg-white/15 text-white" : undefined}
                  >
                    {num(row.leads)}
                  </Badge>
                </Button>
              );
            })}
          </div>
          {sourceFilter === "TikTok" && !data.tiktokConfigured ? (
            <p className="text-xs text-muted">
              TikTok-leads tellen al mee. Campagnesperk volgt na eenmalig
              koppelen.{" "}
              <a
                href={tiktokAuthUrl()}
                className="font-semibold text-[#0a4727] underline"
              >
                Koppel TikTok Ads
              </a>
            </p>
          ) : null}
          {sourceFilter === "TikTok" && data.tiktokError ? (
            <p className="text-xs text-red-700">{data.tiktokError}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-10">
            <Kpi label="Spend" value={formatEuro(t?.spend ?? 0)} />
            <Kpi label="Leads" value={num(t?.leads)} />
            <Kpi
              label="CPL"
              value={t?.cpl != null ? formatEuro(t.cpl) : "—"}
            />
            <Kpi label="Afspraken" value={num(t?.afspraken)} />
            <Kpi
              label="CPA"
              value={t?.cpa != null ? formatEuro(t.cpa) : "—"}
            />
            <Kpi label="Deals" value={num(t?.deals)} />
            <Kpi
              label="CPD"
              value={t?.cac != null ? formatEuro(t.cac) : "—"}
            />
            <Kpi label="Omzet" value={formatEuro(t?.omzet ?? 0)} />
            <Kpi
              label="RPA"
              value={t?.rpa != null ? formatEuro(t.rpa) : "—"}
            />
            <Kpi label="ROAS" value={fmtRoas(t?.roas)} />
          </div>

          <Card className="overflow-hidden shadow-sm">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                {drillWeek ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setDrillWeekKey(null)}
                  >
                    ← Weken
                  </Button>
                ) : null}
                <p className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
                  {sourceFilter !== "all" ? (
                    <SourceBrandMark
                      source={sourceFilter}
                      className="h-3.5 w-3.5"
                    />
                  ) : (
                    <ChannelLogos className="h-3.5 w-3.5" />
                  )}
                  {chartTitle}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-3 rounded-sm bg-[#8FCBAA]" />
                  Spend
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-3 rounded-sm bg-[#0a4727]" />
                  Leads
                </span>
                {drillWeek ? (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-[#0a4727]" />
                      Cum. leads
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-4 bg-[#C45A12]" />
                      Schema (doel)
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-4 bg-[#C45A12]" />
                    Leads nodig
                  </span>
                )}
              </div>
            </header>
            <div className="px-1 py-3 sm:px-2">
              <MarketingTrendChart
                buckets={chartBuckets}
                compareLabel={compareLabel}
                paceMode={Boolean(drillWeek)}
                onBucketClick={
                  mode === "weeks" && !drillWeek
                    ? (bk) => setDrillWeekKey(bk.key)
                    : mode === "month"
                      ? (bk) => {
                          setFocusMonthYm(bk.key);
                          setDrillWeekKey(null);
                        }
                      : undefined
                }
              />
              {mode === "weeks" && !drillWeek ? (
                <p className="px-3 pb-1 text-center text-[10px] text-muted">
                  Klik op een week voor de dagen
                </p>
              ) : mode === "month" ? (
                <p className="px-3 pb-1 text-center text-[10px] text-muted">
                  Klik op een maand voor de KPI&apos;s van die maand
                  {focusMonthYm
                    ? ` · nu ${focusMonthYm}`
                    : ""}
                </p>
              ) : null}
            </div>
          </Card>

          <Card className="overflow-hidden shadow-sm">
            <header className="border-b border-line px-4 py-3.5 sm:px-5">
              <p className="flex items-center gap-1.5 font-display text-base font-semibold text-ink">
                <ChannelLogos className="h-3.5 w-3.5" />
                Campagnes
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Maand → week → Social / Native / Search → platform → campagne →
                ad
              </p>
            </header>
            <div className="min-w-0 max-w-full overflow-x-auto p-3 sm:p-4">
              {viewMonths.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  Geen data in deze periode.
                </p>
              ) : (
                <Table className="border-collapse text-[12px] md:min-w-[960px]">
                  <TableHeader>
                    <tr>
                      <th
                        className={`${sheetHead} sticky left-0 z-10 max-w-[8.5rem] whitespace-normal text-left md:max-w-none`}
                      >
                        Periode
                      </th>
                      {METRIC_HEADERS}
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {viewMonths.map((month) => {
                      const mOpen = openMonths.has(month.monthKey);
                      const monthSelected =
                        mode === "month" && month.monthKey === monthYm;
                      return (
                        <Fragment key={month.monthKey}>
                          <tr
                            className="cursor-pointer hover:bg-[#FAFBFA]"
                            onClick={() => toggleMonth(month.monthKey)}
                          >
                            <td
                              className={`${
                                monthSelected
                                  ? sheetSelectedLabel.replace("pl-5", "pl-2.5")
                                  : sheetTotal
                              } sticky left-0 z-[1] max-w-[8.5rem] whitespace-normal text-left capitalize md:max-w-none`}
                            >
                              <span className="inline-flex items-center gap-1.5">
                                <span className="w-3 text-muted">
                                  {mOpen ? "▾" : "▸"}
                                </span>
                                {month.label}
                              </span>
                            </td>
                            <MetricsCells
                              m={month}
                              tone={monthSelected ? "selected" : "total"}
                            />
                          </tr>
                          {mOpen
                            ? month.weeks.map((wk) => {
                                const wOpen = openWeeks.has(wk.weekKey);
                                const weekSelected =
                                  mode === "weeks" && wk.weekKey === weekKey;
                                const channels =
                                  wk.channels?.length
                                    ? wk.channels
                                    : buildChannelsFromCampaigns(
                                        wk.campaigns || []
                                      );
                                return (
                                  <Fragment key={wk.weekKey}>
                                    <tr
                                      className="cursor-pointer hover:bg-[#FAFBFA]"
                                      onClick={() => toggleWeek(wk.weekKey)}
                                    >
                                      <td
                                        className={`${
                                          weekSelected
                                            ? sheetSelectedLabel
                                            : `${sheetCell} bg-[#FAFBFA] pl-6 text-left font-medium`
                                        } sticky left-0 z-[1] max-w-[8.5rem] whitespace-normal md:max-w-none`}
                                      >
                                        <span className="inline-flex items-center gap-1.5">
                                          <span className="w-3 text-muted">
                                            {wOpen ? "▾" : "▸"}
                                          </span>
                                          {wk.label}
                                        </span>
                                      </td>
                                      <MetricsCells
                                        m={wk}
                                        tone={
                                          weekSelected ? "selected" : "week"
                                        }
                                      />
                                    </tr>
                                    {wOpen
                                      ? channels.map((ch) => {
                                          const chKey = channelRowKey(
                                            wk.weekKey,
                                            ch.key
                                          );
                                          const chOpen = openChannels.has(chKey);
                                          const hasPlatforms =
                                            ch.platforms.length > 0;
                                          return (
                                            <Fragment
                                              key={`${wk.weekKey}-${ch.key}`}
                                            >
                                              <tr
                                                className={
                                                  hasPlatforms
                                                    ? "cursor-pointer hover:bg-[#FAFBFA]"
                                                    : ""
                                                }
                                                onClick={
                                                  hasPlatforms
                                                    ? () =>
                                                        toggleKey(
                                                          setOpenChannels,
                                                          chKey
                                                        )
                                                    : undefined
                                                }
                                              >
                                                <td
                                                  className={`${sheetCell} sticky left-0 z-[1] max-w-[8.5rem] whitespace-normal bg-[#F7F9F8] pl-9 text-left font-semibold md:max-w-[18rem]`}
                                                >
                                                  <span className="inline-flex items-center gap-1.5">
                                                    <span className="w-3 text-muted">
                                                      {hasPlatforms
                                                        ? chOpen
                                                          ? "▾"
                                                          : "▸"
                                                        : "·"}
                                                    </span>
                                                    {ch.label}
                                                  </span>
                                                </td>
                                                <MetricsCells m={ch} />
                                              </tr>
                                              {chOpen
                                                ? ch.platforms.map((pl) => {
                                                    const plKey =
                                                      platformRowKey(
                                                        wk.weekKey,
                                                        pl.key
                                                      );
                                                    const plOpen =
                                                      openPlatforms.has(plKey);
                                                    const hasCamps =
                                                      pl.campaigns.length > 0;
                                                    return (
                                                      <Fragment
                                                        key={`${wk.weekKey}-${pl.key}`}
                                                      >
                                                        <tr
                                                          className={
                                                            hasCamps
                                                              ? "cursor-pointer hover:bg-[#FAFBFA]"
                                                              : ""
                                                          }
                                                          onClick={
                                                            hasCamps
                                                              ? () =>
                                                                  toggleKey(
                                                                    setOpenPlatforms,
                                                                    plKey
                                                                  )
                                                              : undefined
                                                          }
                                                        >
                                                          <td
                                                            className={`${sheetCell} sticky left-0 z-[1] max-w-[8.5rem] whitespace-normal bg-white pl-12 text-left font-medium md:max-w-[18rem]`}
                                                          >
                                                            <span className="flex items-center gap-1.5">
                                                              <span className="w-3 shrink-0 text-muted">
                                                                {hasCamps
                                                                  ? plOpen
                                                                    ? "▾"
                                                                    : "▸"
                                                                  : "·"}
                                                              </span>
                                                              <SourceBrandMark
                                                                source={pl.key}
                                                                className="h-3.5 w-3.5 shrink-0"
                                                              />
                                                              <span className="truncate">
                                                                {pl.label}
                                                              </span>
                                                            </span>
                                                          </td>
                                                          <MetricsCells m={pl} />
                                                        </tr>
                                                        {plOpen
                                                          ? [...pl.campaigns]
                                                              .sort(
                                                                (a, b) =>
                                                                  b.spend -
                                                                    a.spend ||
                                                                  b.leads -
                                                                    a.leads
                                                              )
                                                              .map((c) => {
                                                                const ads = [
                                                                  ...(c.ads ||
                                                                    []),
                                                                ].sort(
                                                                  (a, b) =>
                                                                    b.spend -
                                                                      a.spend ||
                                                                    b.leads -
                                                                      a.leads
                                                                );
                                                                const hasAds =
                                                                  ads.length >
                                                                  0;
                                                                const cKey =
                                                                  campaignRowKey(
                                                                    wk.weekKey,
                                                                    c.source ||
                                                                      pl.key,
                                                                    c.key
                                                                  );
                                                                const cOpen =
                                                                  openCampaigns.has(
                                                                    cKey
                                                                  );
                                                                return (
                                                                  <Fragment
                                                                    key={cKey}
                                                                  >
                                                                    <tr
                                                                      className={
                                                                        hasAds
                                                                          ? "cursor-pointer hover:bg-[#FAFBFA]"
                                                                          : "hover:bg-[#FAFBFA]"
                                                                      }
                                                                      onClick={
                                                                        hasAds
                                                                          ? () =>
                                                                              toggleKey(
                                                                                setOpenCampaigns,
                                                                                cKey
                                                                              )
                                                                          : undefined
                                                                      }
                                                                    >
                                                                      <td
                                                                        className={`${sheetCell} sticky left-0 z-[1] max-w-[8.5rem] whitespace-normal bg-white pl-16 text-left font-medium md:max-w-[18rem]`}
                                                                      >
                                                                        <span className="flex items-center gap-1.5">
                                                                          <span className="w-3 shrink-0 text-muted">
                                                                            {hasAds
                                                                              ? cOpen
                                                                                ? "▾"
                                                                                : "▸"
                                                                              : ""}
                                                                          </span>
                                                                          <span
                                                                            className="truncate"
                                                                            title={
                                                                              c.label
                                                                            }
                                                                          >
                                                                            {
                                                                              c.label
                                                                            }
                                                                          </span>
                                                                        </span>
                                                                      </td>
                                                                      <MetricsCells
                                                                        m={c}
                                                                      />
                                                                    </tr>
                                                                    {cOpen
                                                                      ? ads.map(
                                                                          (
                                                                            ad
                                                                          ) => (
                                                                            <tr
                                                                              key={`${cKey}-${ad.key}`}
                                                                              className="hover:bg-[#FAFBFA]"
                                                                            >
                                                                              <td
                                                                                className={`${sheetCell} sticky left-0 z-[1] max-w-[8.5rem] whitespace-normal bg-white pl-20 text-left font-normal text-ink md:max-w-[18rem]`}
                                                                              >
                                                                                <span
                                                                                  className="truncate"
                                                                                  title={
                                                                                    ad.label
                                                                                  }
                                                                                >
                                                                                  {
                                                                                    ad.label
                                                                                  }
                                                                                </span>
                                                                              </td>
                                                                              <MetricsCells
                                                                                m={
                                                                                  ad
                                                                                }
                                                                              />
                                                                            </tr>
                                                                          )
                                                                        )
                                                                      : null}
                                                                  </Fragment>
                                                                );
                                                              })
                                                          : null}
                                                      </Fragment>
                                                    );
                                                  })
                                                : null}
                                            </Fragment>
                                          );
                                        })
                                      : null}
                                  </Fragment>
                                );
                              })
                            : null}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </Card>

          <p className="text-[11px] text-muted">
            {data.lastSyncAt
              ? `Laatste Meta-sync: ${new Date(data.lastSyncAt).toLocaleString("nl-NL")}`
              : "Meta-spend sync actief"}
            {" · "}
            {data.tiktokConfigured
              ? "TikTok-spend gekoppeld"
              : "TikTok: leads tellen mee · spend na koppelen"}
          </p>
        </>
      ) : null}
    </div>
  );
}

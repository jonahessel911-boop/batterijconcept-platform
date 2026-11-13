"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEuro } from "@/lib/format";
import { RECRUITMENT_ROL_LABEL } from "@/lib/recruitment-rollen";
import type { RecruitmentRol, RecruitmentVacature } from "@/types/database";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

type MetricRow = {
  id: string;
  name: string;
  spend: number;
  /** Meta Insights lead/results */
  leads: number;
  /** CRM-sollicitaties met deze campagne/ad-id */
  crm_apps?: number;
  impressions?: number;
  clicks?: number;
  ctr?: number | null;
  hires: number;
  cpl: number | null;
  cph: number | null;
  vacature_id: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
};

type MarketingPayload = {
  accountId: string;
  since: string;
  until: string;
  configured: boolean;
  metaOk: boolean;
  metaError: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  metaLeads: number;
  sollicitaties: number;
  applications: number;
  appsAttributed?: number;
  attributionRate?: number | null;
  hires: number;
  cpl: number | null;
  cph: number | null;
  campaigns: MetricRow[];
  ads: MetricRow[];
  vacatures: Array<
    Pick<RecruitmentVacature, "id" | "titel" | "rol" | "status">
  >;
};

function rolLabel(rol: string) {
  if (rol in RECRUITMENT_ROL_LABEL) {
    return RECRUITMENT_ROL_LABEL[rol as RecruitmentRol];
  }
  return rol;
}

function num(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function pct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}%`;
}

function hireFmt(n: number) {
  if (!n) return "—";
  return String(Math.round(n));
}

function euroCell(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return formatEuro(n);
}

export function RecruitmentMarketingView() {
  const [data, setData] = useState<MarketingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [daysBack, setDaysBack] = useState(30);
  const [vacatureFilter, setVacatureFilter] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string | null>>({});
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const until = new Date();
      const since = new Date();
      since.setDate(until.getDate() - (daysBack - 1));
      const fmt = (d: Date) =>
        d.toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
      const qs = new URLSearchParams({
        since: fmt(since),
        until: fmt(until),
      });
      const res = await fetch(`/api/instroom/marketing?${qs}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Marketing laden mislukt");
      const payload = json as MarketingPayload;
      setData(payload);
      const next: Record<string, string | null> = {};
      for (const c of payload.campaigns || []) {
        next[c.id] = c.vacature_id;
      }
      setLinks(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [daysBack]);

  useEffect(() => {
    void load();
  }, [load]);

  const vacatureById = useMemo(() => {
    const m = new Map<
      string,
      Pick<RecruitmentVacature, "id" | "titel" | "rol" | "status">
    >();
    for (const v of data?.vacatures || []) m.set(v.id, v);
    return m;
  }, [data?.vacatures]);

  const adsByCampaign = useMemo(() => {
    const m = new Map<string, MetricRow[]>();
    for (const a of data?.ads || []) {
      const cid = a.campaign_id || "unknown";
      const list = m.get(cid) || [];
      list.push(a);
      m.set(cid, list);
    }
    for (const [, list] of m) {
      list.sort((a, b) => b.spend - a.spend);
    }
    return m;
  }, [data?.ads]);

  const campaigns = useMemo(() => {
    const list = data?.campaigns || [];
    if (!vacatureFilter) return list;
    if (vacatureFilter === "__none__") {
      return list.filter((c) => !links[c.id]);
    }
    return list.filter((c) => links[c.id] === vacatureFilter);
  }, [data?.campaigns, links, vacatureFilter]);

  function toggleOpen(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setOpenIds(new Set(campaigns.map((c) => c.id)));
  }

  function collapseAll() {
    setOpenIds(new Set());
  }

  async function setVacature(campaign: MetricRow, vacatureId: string) {
    setSavingId(campaign.id);
    setError(null);
    setInfo(null);
    const nextId = vacatureId || null;
    const prev = links[campaign.id] ?? null;
    setLinks((m) => ({ ...m, [campaign.id]: nextId }));
    try {
      const res = await fetch("/api/instroom/marketing/koppelingen", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          vacature_id: nextId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Koppelen mislukt");
      const titel = nextId ? vacatureById.get(nextId)?.titel : null;
      setInfo(
        nextId
          ? `Gekoppeld aan “${titel || "vacature"}”.`
          : "Koppeling verwijderd."
      );
    } catch (e) {
      setLinks((m) => ({ ...m, [campaign.id]: prev }));
      setError(e instanceof Error ? e.message : "Koppelen mislukt");
    } finally {
      setSavingId(null);
    }
  }

  const totals = data
    ? {
        spend: data.spend,
        metaLeads: data.metaLeads,
        crmApps: data.applications,
        impressions: data.impressions,
        clicks: data.clicks,
        ctr: data.ctr,
        cpl: data.cpl,
        hires: data.hires,
        cph: data.cph,
        appsAttributed: data.appsAttributed ?? 0,
        attributionRate: data.attributionRate ?? null,
      }
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 border border-line bg-white px-3 py-2.5">
        <NativeSelect
          value={String(daysBack)}
          onChange={(e) => setDaysBack(Number(e.target.value))}
          aria-label="Periode"
          className="h-8 text-xs"
        >
          <NativeSelectOption value="7">7 dagen</NativeSelectOption>
          <NativeSelectOption value="14">14 dagen</NativeSelectOption>
          <NativeSelectOption value="30">30 dagen</NativeSelectOption>
          <NativeSelectOption value="90">90 dagen</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          value={vacatureFilter}
          onChange={(e) => setVacatureFilter(e.target.value)}
          aria-label="Filter vacature"
          className="h-8 text-xs"
        >
          <NativeSelectOption value="">Alle vacatures</NativeSelectOption>
          <NativeSelectOption value="__none__">
            Nog niet gekoppeld
          </NativeSelectOption>
          {(data?.vacatures || []).map((v) => (
            <NativeSelectOption key={v.id} value={v.id}>
              {v.titel}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => void load()}
        >
          Vernieuwen
        </Button>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={expandAll}
            disabled={!campaigns.length}
          >
            Alles open
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={collapseAll}
            disabled={!openIds.size}
          >
            Alles dicht
          </Button>
        </div>
        {data ? (
          <p className="w-full font-mono text-[10px] text-muted sm:w-auto sm:ml-0">
            {data.since} → {data.until}
            {totals
              ? ` · CRM ${totals.crmApps} apps · ${totals.appsAttributed} met campagne-id${
                  totals.attributionRate != null
                    ? ` (${totals.attributionRate}%)`
                    : ""
                } · Meta ${totals.metaLeads} results`
              : ""}
            {!data.metaOk && data.metaError ? ` · Meta: ${data.metaError}` : ""}
          </p>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert className="border-green/30 bg-green-soft text-green-deeper">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      {loading && !data ? (
        <div className="space-y-2 border border-line bg-white p-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      ) : (
        <div className="overflow-hidden border border-line bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] border-collapse text-left text-[12px]">
              <thead className="bg-wash/80 text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-7 px-1.5 py-2 font-medium" />
                  <th className="px-2 py-2 font-medium">Campagne / ad</th>
                  <th className="min-w-[9.5rem] px-2 py-2 font-medium">
                    Vacature
                  </th>
                  <th className="px-2 py-2 text-right font-medium">Spend</th>
                  <th className="px-2 py-2 text-right font-medium">Imp.</th>
                  <th className="px-2 py-2 text-right font-medium">Clicks</th>
                  <th className="px-2 py-2 text-right font-medium">CTR</th>
                  <th className="px-2 py-2 text-right font-medium" title="Meta Insights results">
                    Meta
                  </th>
                  <th className="px-2 py-2 text-right font-medium" title="CRM sollicitaties met campagne-/ad-id">
                    CRM
                  </th>
                  <th className="px-2 py-2 text-right font-medium">CPL</th>
                  <th className="px-2 py-2 text-right font-medium">Hires</th>
                  <th className="px-2 py-2 text-right font-medium">CPH</th>
                </tr>
              </thead>
              <tbody>
                {totals ? (
                  <tr className="border-t border-line bg-wash/50 font-semibold text-ink">
                    <td className="px-1.5 py-1.5" />
                    <td className="px-2 py-1.5">Totaal</td>
                    <td className="px-2 py-1.5 text-muted">—</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                      {euroCell(totals.spend)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {num(totals.impressions)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {num(totals.clicks)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {pct(totals.ctr)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {totals.metaLeads}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {totals.crmApps}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-green-deeper">
                      {euroCell(totals.cpl)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {hireFmt(totals.hires)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                      {euroCell(totals.cph)}
                    </td>
                  </tr>
                ) : null}

                {campaigns.length === 0 ? (
                  <tr>
                    <td
                      colSpan={12}
                      className="px-3 py-10 text-center text-sm text-muted"
                    >
                      Geen campagnes
                      {data && !data.configured
                        ? " — Meta token ontbreekt"
                        : ""}
                    </td>
                  </tr>
                ) : (
                  campaigns.map((c) => {
                    const open = openIds.has(c.id);
                    const ads = adsByCampaign.get(c.id) || [];
                    const vacId = links[c.id] || "";
                    const vac = vacId ? vacatureById.get(vacId) : null;
                    return (
                      <CampaignBlock
                        key={c.id}
                        campaign={c}
                        ads={ads}
                        open={open}
                        onToggle={() => toggleOpen(c.id)}
                        vacId={vacId}
                        vac={vac || null}
                        vacatures={data?.vacatures || []}
                        saving={savingId === c.id}
                        onSetVacature={(id) => void setVacature(c, id)}
                      />
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function CampaignBlock({
  campaign,
  ads,
  open,
  onToggle,
  vacId,
  vac,
  vacatures,
  saving,
  onSetVacature,
}: {
  campaign: MetricRow;
  ads: MetricRow[];
  open: boolean;
  onToggle: () => void;
  vacId: string;
  vac: Pick<RecruitmentVacature, "id" | "titel" | "rol" | "status"> | null;
  vacatures: Array<
    Pick<RecruitmentVacature, "id" | "titel" | "rol" | "status">
  >;
  saving: boolean;
  onSetVacature: (vacatureId: string) => void;
}) {
  return (
    <>
      <tr className="border-t border-line hover:bg-wash/40">
        <td className="px-1.5 py-1.5 align-middle">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex size-6 items-center justify-center text-muted hover:bg-wash hover:text-ink"
            aria-expanded={open}
            aria-label={open ? "Ads inklappen" : "Ads uitklappen"}
          >
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        </td>
        <td className="max-w-[260px] px-2 py-1.5 align-middle">
          <button
            type="button"
            onClick={onToggle}
            className="block w-full text-left"
          >
            <p className="truncate text-[12px] font-semibold text-ink">
              {campaign.name}
            </p>
            <p className="truncate font-mono text-[9px] text-muted">
              {campaign.id} · {ads.length} ad{ads.length === 1 ? "" : "s"}
            </p>
          </button>
        </td>
        <td className="px-2 py-1.5 align-middle">
          <select
            value={vacId}
            disabled={saving}
            onChange={(e) => onSetVacature(e.target.value)}
            className="h-7 w-full max-w-[11rem] cursor-pointer border border-line bg-white px-1.5 text-[11px] text-ink outline-none focus:border-green disabled:opacity-50"
            aria-label={`Vacature voor ${campaign.name}`}
          >
            <option value="">— Vacature —</option>
            {vacatures.map((v) => (
              <option key={v.id} value={v.id}>
                {v.titel}
              </option>
            ))}
          </select>
          {vac ? (
            <p className="mt-0.5 truncate text-[9px] text-muted">
              {rolLabel(vac.rol)}
            </p>
          ) : (
            <p className="mt-0.5 text-[9px] text-[#C45A12]">Niet gekoppeld</p>
          )}
        </td>
        <MetricCells row={campaign} strong />
      </tr>
      {open
        ? ads.map((a) => (
            <tr
              key={a.id}
              className="border-t border-line/70 bg-[#FAFBFA] hover:bg-wash/50"
            >
              <td className="px-1.5 py-1" />
              <td className="max-w-[260px] px-2 py-1 pl-6 align-middle">
                <p className="truncate text-[11px] font-medium text-ink">
                  {a.name}
                </p>
                <p className="truncate font-mono text-[9px] text-muted">
                  {a.id}
                </p>
              </td>
              <td className="px-2 py-1 align-middle text-[10px] text-muted">
                —
              </td>
              <MetricCells row={a} />
            </tr>
          ))
        : null}
      {open && ads.length === 0 ? (
        <tr className="border-t border-line/70 bg-[#FAFBFA]">
          <td />
          <td
            colSpan={11}
            className="px-2 py-2 pl-6 text-[11px] text-muted"
          >
            Geen ads in deze periode
          </td>
        </tr>
      ) : null}
    </>
  );
}

function MetricCells({
  row,
  strong,
}: {
  row: MetricRow;
  strong?: boolean;
}) {
  return (
    <>
      <td
        className={cn(
          "px-2 py-1.5 text-right tabular-nums whitespace-nowrap align-middle",
          strong && "font-semibold"
        )}
      >
        {euroCell(row.spend)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums align-middle">
        {num(row.impressions)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums align-middle">
        {num(row.clicks)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums align-middle">
        {pct(row.ctr)}
      </td>
      <td
        className={cn(
          "px-2 py-1.5 text-right tabular-nums align-middle",
          strong && "font-semibold"
        )}
      >
        {row.leads || "—"}
      </td>
      <td
        className={cn(
          "px-2 py-1.5 text-right tabular-nums align-middle",
          strong && "font-semibold"
        )}
      >
        {row.crm_apps ? row.crm_apps : "—"}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap align-middle text-green-deeper">
        {euroCell(row.cpl)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums align-middle">
        {hireFmt(row.hires)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap align-middle">
        {euroCell(row.cph)}
      </td>
    </>
  );
}

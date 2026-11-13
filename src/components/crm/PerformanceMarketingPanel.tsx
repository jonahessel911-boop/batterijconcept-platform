"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { formatEuro } from "@/lib/format";
import type {
  CreativeLibrary,
  CreativeLibraryItem,
  PerformanceMetricRow,
} from "@/lib/performance-marketing";
import { SourceBrandMark } from "./SourceBrandMark";
import { ForeplayResearchView } from "./pm/ForeplayResearchView";
import { CreativeLibraryView } from "./pm/CreativeLibraryView";
import { MetaWinnerAlternativesModal } from "./pm/MetaWinnerAlternativesModal";
import { GenerationQueuePanel } from "./pm/GenerationQueuePanel";

type MetaCreative = {
  adId: string;
  adName: string;
  campaignName: string | null;
  status: string | null;
  title: string | null;
  body: string | null;
  cta: string | null;
  linkUrl: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
};

type Payload = {
  from: string;
  to: string;
  totals: PerformanceMetricRow;
  best: {
    cplCampaign: PerformanceMetricRow | null;
    cpaCampaign: PerformanceMetricRow | null;
    cpdCampaign: PerformanceMetricRow | null;
    cplAd: PerformanceMetricRow | null;
    cpaAd: PerformanceMetricRow | null;
    cpdAd: PerformanceMetricRow | null;
  };
  channels: PerformanceMetricRow[];
  platforms: PerformanceMetricRow[];
  campaigns: PerformanceMetricRow[];
  ads: PerformanceMetricRow[];
  metaCreatives: MetaCreative[];
  library: CreativeLibrary;
  metaConfigured: boolean;
  tiktokConfigured: boolean;
  tiktokError?: string | null;
  publishEnabled: boolean;
  error?: string;
};

type SubTab = "performance" | "foreplay" | "library" | "launch";

type ForeplayWinner = {
  query: string;
  score: number;
  angle: string;
  nicheId?: string;
  nicheLabel?: string;
  ad: {
    id: string;
    name: string | null;
    headline: string | null;
    description: string | null;
    image: string | null;
    thumbnail: string | null;
    running_duration: { days?: number } | null;
    live: boolean | null;
    foreplay_url?: string | null;
  };
};

type HotNiche = {
  id: string;
  label: string;
  why: string;
  queries: string[];
  seedBrands: string[];
};

type TofBrief = {
  id: string;
  sourceQuery: string;
  sourceAdId: string;
  sourceBrand: string;
  sourceRunningDays: number;
  angle: string;
  region: string;
  primaryText: string;
  headline: string;
  cardboardText: string;
  imagePrompt: string;
  platform: "Meta" | "TikTok";
  format: string;
  adName: string;
  sourceImageUrl: string | null;
};

type ForeplayPayload = {
  configured: boolean;
  refreshed?: boolean;
  usage: { totalCredits: number; remainingCredits: number; email: string | null } | null;
  niches?: HotNiche[];
  followedIds?: string[];
  cache: {
    updatedAt: string;
    queries: string[];
    followedNicheIds?: string[];
    winners: ForeplayWinner[];
    discoveredBrands?: { name: string; nicheId: string; count: number }[];
    briefs: TofBrief[];
  };
  error?: string;
};

type TrackedBrand = {
  id: string;
  name: string;
  category: string | null;
  avatar: string | null;
  adsCount: number | null;
  activeAdsCount: number | null;
  nicheHint: string | null;
};

type BrandsPayload = {
  configured: boolean;
  store: {
    brands: TrackedBrand[];
    lastPullAt: string | null;
    lastPullAds: unknown[];
  };
  suggestions: { query: string; nicheHint: string }[];
};

function euro(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatEuro(n);
}

function pct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
}

function BestCard({
  label,
  row,
  metric,
}: {
  label: string;
  row: PerformanceMetricRow | null;
  metric: "cpl" | "cpa" | "cpd";
}) {
  const value =
    metric === "cpl" ? row?.cpl : metric === "cpa" ? row?.cpa : row?.cpd;
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3 shadow-[0_1px_0_rgba(26,31,28,0.04)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-green-dark">
        {euro(value)}
      </p>
      <p className="mt-1 truncate text-xs text-ink">{row?.label || "—"}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
        {row ? <SourceBrandMark source={row.platform} className="h-3 w-4" /> : null}
        {row
          ? `${row.afspraken} afspr · ${row.deals} deals · ${row.channel}`
          : "Geen sample"}
      </p>
    </div>
  );
}

function MetricTable({
  title,
  rows,
  showParent,
}: {
  title: string;
  rows: PerformanceMetricRow[];
  showParent?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-wash/80 text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Naam</th>
              <th className="px-3 py-2.5 font-medium">Platform</th>
              <th className="px-3 py-2.5 font-medium">Channel</th>
              <th className="px-3 py-2.5 font-medium text-right">Spend</th>
              <th className="px-3 py-2.5 font-medium text-right">CPL</th>
              <th className="px-3 py-2.5 font-medium text-right">CPA</th>
              <th className="px-3 py-2.5 font-medium text-right">CPD</th>
              <th className="px-3 py-2.5 font-medium text-right">Afspr</th>
              <th className="px-4 py-2.5 font-medium text-right">Deals</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted">
                  Geen data in deze periode.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-ink">{r.label}</p>
                    {showParent && r.parentKey ? (
                      <p className="text-[11px] text-muted">{r.parentKey}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <SourceBrandMark source={r.platform} className="h-3.5 w-5" />
                      <span className="text-xs text-muted">{r.platform}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 capitalize text-muted">{r.channel}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{euro(r.spend)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{euro(r.cpl)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-green-dark">
                    {euro(r.cpa)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink">
                    {euro(r.cpd)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.afspraken}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.deals}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function statusBadge(status: CreativeLibraryItem["status"]) {
  if (status === "ready") {
    return {
      label: "Launch draft · seed",
      className: "bg-green-dark text-white",
    };
  }
  if (status === "archived") {
    return { label: "Afgekeurd", className: "bg-[#C45A12] text-white" };
  }
  return { label: "Review", className: "bg-ink/70 text-white" };
}

function CreativeCard({
  item,
  selected,
  onToggle,
}: {
  item: CreativeLibraryItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const badge = statusBadge(item.status);
  return (
    <button
      type="button"
      onClick={onToggle}
      className={[
        "group relative overflow-hidden rounded-xl border bg-white text-left transition",
        item.status === "archived" ? "opacity-60" : "",
        selected
          ? "border-green-dark ring-2 ring-green/30"
          : "border-line hover:border-green-dark/40",
      ].join(" ")}
    >
      <div
        className={[
          "relative bg-wash",
          item.format === "9x16" ? "aspect-[9/16]" : "aspect-square",
        ].join(" ")}
      >
        <Image
          src={item.imageUrl}
          alt={item.adName}
          fill
          className="object-cover"
          unoptimized
        />
        <span className="absolute left-2 top-2 rounded bg-ink/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {item.platform} · {item.format}
        </span>
        <span
          className={[
            "absolute bottom-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-semibold",
            badge.className,
          ].join(" ")}
        >
          {badge.label}
        </span>
        {selected ? (
          <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-green-dark text-xs font-bold text-white">
            ✓
          </span>
        ) : null}
      </div>
      <div className="space-y-1 px-3 py-2.5">
        <p className="truncate font-mono text-[11px] font-semibold text-ink">
          {item.adName}
        </p>
        <p className="truncate text-[11px] text-muted">{item.headline}</p>
      </div>
    </button>
  );
}

export function PerformanceMarketingPanel() {
  const [tab, setTab] = useState<SubTab>("foreplay");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [foreplay, setForeplay] = useState<ForeplayPayload | null>(null);
  const [fpLoading, setFpLoading] = useState(false);
  const [fpError, setFpError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [brands, setBrands] = useState<BrandsPayload | null>(null);
  const [brandBusy, setBrandBusy] = useState(false);
  const [brandMsg, setBrandMsg] = useState<string | null>(null);
  const [followedIds, setFollowedIds] = useState<string[]>([]);
  const [niches, setNiches] = useState<HotNiche[]>([]);
  const [metaWinner, setMetaWinner] = useState<MetaCreative | null>(null);
  const [libraryItems, setLibraryItems] = useState<CreativeLibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [queueHighlight, setQueueHighlight] = useState(0);

  const applyLibraryItems = useCallback((items: CreativeLibraryItem[]) => {
    setLibraryItems(items);
    setData((prev) =>
      prev
        ? {
            ...prev,
            library: {
              ...prev.library,
              items,
              updatedAt: new Date().toISOString(),
            },
          }
        : prev
    );
    const win =
      items.find((i) => i.status === "ready") ||
      items.find((i) => i.id === "winner-ad11-meta") ||
      items.find((i) => i.sourceWinnerAdName === "AD11") ||
      null;
    setWinnerId((prev) => prev || win?.id || null);
  }, []);

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      const res = await fetch("/api/performance-marketing/library", {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        error?: string;
        library?: CreativeLibrary;
      };
      if (!res.ok) throw new Error(json.error || "Library laden mislukt");
      applyLibraryItems(json.library?.items || []);
    } catch (e) {
      setLibraryError(e instanceof Error ? e.message : "Library fout");
    } finally {
      setLibraryLoading(false);
    }
  }, [applyLibraryItems]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/performance-marketing", { cache: "no-store" });
      const json = (await res.json()) as Payload;
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData(json);
      if (json.library?.items?.length) {
        applyLibraryItems(json.library.items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [applyLibraryItems]);

  const loadForeplay = useCallback(async (refresh = false) => {
    setFpLoading(true);
    setFpError(null);
    try {
      const res = await fetch(
        `/api/performance-marketing/foreplay${refresh ? "?refresh=1" : ""}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as ForeplayPayload;
      if (!res.ok) throw new Error(json.error || "Foreplay laden mislukt");
      setForeplay(json);
      if (json.niches) setNiches(json.niches);
      if (json.followedIds) setFollowedIds(json.followedIds);
    } catch (e) {
      setFpError(e instanceof Error ? e.message : "Foreplay fout");
    } finally {
      setFpLoading(false);
    }
  }, []);

  const loadBrands = useCallback(async () => {
    try {
      const res = await fetch("/api/performance-marketing/foreplay/brands", {
        cache: "no-store",
      });
      const json = (await res.json()) as BrandsPayload & { error?: string };
      if (!res.ok) throw new Error(json.error || "Brands laden mislukt");
      setBrands(json);
    } catch (e) {
      setBrandMsg(e instanceof Error ? e.message : "Brands fout");
    }
  }, []);

  const toggleNiche = useCallback(async (nicheId: string) => {
    setFpLoading(true);
    try {
      const res = await fetch("/api/performance-marketing/foreplay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "follow_toggle", nicheId }),
      });
      const json = (await res.json()) as {
        error?: string;
        followedIds?: string[];
      };
      if (!res.ok) throw new Error(json.error || "Follow mislukt");
      if (json.followedIds) setFollowedIds(json.followedIds);
    } catch (e) {
      setFpError(e instanceof Error ? e.message : "Follow fout");
    } finally {
      setFpLoading(false);
    }
  }, []);

  const trackDiscoveredBrand = useCallback(
    async (name: string, nicheHint?: string) => {
      setBrandBusy(true);
      setBrandMsg(null);
      try {
        const res = await fetch("/api/performance-marketing/foreplay/brands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "track_search",
            query: name,
            nicheHint: nicheHint || null,
          }),
        });
        const json = (await res.json()) as {
          error?: string;
          store?: BrandsPayload["store"];
          added?: { name?: string };
        };
        if (!res.ok) throw new Error(json.error || "Track mislukt");
        if (json.store) {
          setBrands((prev) =>
            prev
              ? { ...prev, store: json.store! }
              : { configured: true, store: json.store!, suggestions: [] }
          );
        }
        setBrandMsg(`Tracked: ${json.added?.name || name}`);
      } catch (e) {
        setBrandMsg(e instanceof Error ? e.message : "Track fout");
      } finally {
        setBrandBusy(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadLibrary();
    void load();
    void loadForeplay(false);
    void loadBrands();
  }, [loadLibrary, load, loadForeplay, loadBrands]);

  const launchReady = useMemo(
    () =>
      libraryItems.filter(
        (i) => i.status === "ready" || i.tier === "winner"
      ),
    [libraryItems]
  );
  const seedWinners = useMemo(
    () =>
      libraryItems.filter(
        (i) =>
          i.status === "ready" ||
          i.tier === "winner" ||
          i.id.startsWith("winner-")
      ),
    [libraryItems]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const applyStatus = useCallback(
    async (action: "approve" | "reject" | "unapprove") => {
      const ids = [...selected];
      if (ids.length === 0) {
        setStatusMsg("Selecteer eerst creatives.");
        return;
      }
      setStatusBusy(true);
      setStatusMsg(null);
      try {
        const res = await fetch("/api/performance-marketing/library", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ids }),
        });
        const json = (await res.json()) as {
          error?: string;
          library?: Payload["library"];
          ready?: CreativeLibraryItem[];
        };
        if (!res.ok) throw new Error(json.error || "Status update mislukt");
        if (json.library?.items) {
          applyLibraryItems(json.library.items);
        }
        setSelected(new Set());
        const n = ids.length;
        if (action === "approve") {
          setStatusMsg(
            `${n} creative${n === 1 ? "" : "s"} → launch draft (seed voor volgende ronde)`
          );
          setWinnerId((prev) => prev || ids[0] || null);
          setTab("launch");
        } else if (action === "reject") {
          setStatusMsg(`${n} afgekeurd — niet meer in launch.`);
        } else {
          setStatusMsg(`${n} teruggezet naar review.`);
        }
      } catch (e) {
        setStatusMsg(e instanceof Error ? e.message : "Status fout");
      } finally {
        setStatusBusy(false);
      }
    },
    [selected, applyLibraryItems]
  );

  return (
    <div className="min-h-[70vh] space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <SourceBrandMark source="Meta" className="h-5 w-7" />
            <SourceBrandMark source="TikTok" className="h-5 w-7" />
            <span className="rounded-full bg-wash px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Admin
            </span>
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">
            Performance Marketing
          </h1>
          <p className="mt-1 text-sm text-muted">
            Foreplay = research · Library = winners / opkomers / new · altijd BC
            funnel (tijdelijke regeling / bijna gratis / €0)
          </p>
          {data ? (
            <p className="mt-1 text-xs text-muted">
              Periode {data.from} → {data.to} · CPA {euro(data.totals.cpa)} · CPD{" "}
              {euro(data.totals.cpd)}
            </p>
          ) : loading ? (
            <p className="mt-1 text-xs font-medium text-green-dark">
              Metrics laden…
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            void loadLibrary();
            void load();
          }}
          disabled={loading || libraryLoading}
          className="h-9 rounded-xl border border-line bg-white px-3 text-xs font-semibold hover:bg-wash disabled:opacity-50"
        >
          {loading || libraryLoading ? "Laden…" : "Vernieuwen"}
        </button>
      </header>

      <div className="inline-flex flex-wrap rounded-xl border border-line bg-wash p-0.5">
        {(
          [
            ["performance", "Performance"],
            ["foreplay", "Foreplay research"],
            ["library", "Creative library"],
            ["launch", "Launch drafts"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={[
              "rounded-lg px-3 py-1.5 text-xs font-semibold",
              tab === id
                ? "bg-green-dark text-white"
                : "text-muted hover:text-ink",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
          {error} — Foreplay/library blijven bruikbaar.
        </p>
      ) : null}
      {statusMsg ? (
        <p className="rounded-xl border border-green-dark/20 bg-wash px-4 py-3 text-sm text-ink">
          {statusMsg}
        </p>
      ) : null}

      {tab === "foreplay" ? (
        <div className="space-y-3">
          {foreplay?.usage ? (
            <p className="text-[11px] text-muted">
              Credits {foreplay.usage.remainingCredits}/{foreplay.usage.totalCredits}
              {brands?.store.brands.length
                ? ` · tracked brands: ${brands.store.brands.map((b) => b.name).join(", ")}`
                : ""}
            </p>
          ) : null}
          <ForeplayResearchView
            niches={niches}
            followedIds={followedIds}
            winners={foreplay?.cache.winners || []}
            discoveredBrands={foreplay?.cache.discoveredBrands || []}
            loading={fpLoading || brandBusy}
            message={fpError || brandMsg}
            onToggleNiche={(id) => void toggleNiche(id)}
            onSwipe={() => void loadForeplay(true)}
            onTrackBrand={(name, nicheId) =>
              void trackDiscoveredBrand(name, nicheId)
            }
            onAddedToLibrary={() => {
              void load();
              setTab("library");
            }}
          />
        </div>
      ) : null}

      {tab === "performance" ? (
        <div className="space-y-5">
          {loading && !data ? (
            <div className="rounded-2xl border border-dashed border-line bg-wash px-4 py-10 text-center">
              <p className="text-sm font-semibold text-ink">Metrics laden…</p>
              <p className="mt-1 text-xs text-muted">
                Meta/TikTok spend + conversies. Of open meteen{" "}
                <button
                  type="button"
                  className="font-semibold text-green-dark underline"
                  onClick={() => setTab("foreplay")}
                >
                  Foreplay → TOF
                </button>{" "}
                /{" "}
                <button
                  type="button"
                  className="font-semibold text-green-dark underline"
                  onClick={() => setTab("library")}
                >
                  Creative library
                </button>
                .
              </p>
            </div>
          ) : null}
          {data ? (
          <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <BestCard label="Beste CPA · campagne" row={data.best.cpaCampaign} metric="cpa" />
            <BestCard label="Beste CPD · campagne" row={data.best.cpdCampaign} metric="cpd" />
            <BestCard label="Beste CPL · campagne" row={data.best.cplCampaign} metric="cpl" />
            <BestCard label="Beste CPA · ad" row={data.best.cpaAd} metric="cpa" />
            <BestCard label="Beste CPD · ad" row={data.best.cpdAd} metric="cpd" />
            <BestCard label="Beste CPL · ad" row={data.best.cplAd} metric="cpl" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {data.platforms.map((p) => (
              <div
                key={p.key}
                className="flex items-center justify-between rounded-2xl border border-line bg-white px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <SourceBrandMark source={p.platform} className="h-6 w-8" />
                  <div>
                    <p className="font-semibold text-ink">{p.label}</p>
                    <p className="text-xs text-muted">
                      {p.afspraken} afspr · {p.deals} deals · close {pct(p.closePct)}
                    </p>
                  </div>
                </div>
                <div className="text-right text-sm">
                  <p className="font-semibold tabular-nums text-green-dark">
                    CPA {euro(p.cpa)}
                  </p>
                  <p className="tabular-nums text-muted">CPD {euro(p.cpd)}</p>
                </div>
              </div>
            ))}
          </div>

          <MetricTable title="Per channel" rows={data.channels} />
          <MetricTable title="Campagnes (gesorteerd op CPA)" rows={data.campaigns} />
          <MetricTable title="Ads (top CPA)" rows={data.ads} showParent />
          </>
          ) : !loading ? (
            <p className="rounded-2xl border border-line bg-wash px-4 py-8 text-center text-sm text-muted">
              Geen performance-data. Check Meta-config of open Foreplay → TOF.
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "library" ? (
        <div className="space-y-8">
          {libraryError ? (
            <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
              {libraryError}{" "}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => void loadLibrary()}
              >
                Opnieuw laden
              </button>
            </p>
          ) : null}
          <GenerationQueuePanel
            highlight={queueHighlight > 0}
            onRefreshLibrary={(items) => {
              if (items?.length) applyLibraryItems(items);
              else void loadLibrary();
            }}
          />

          {libraryLoading && libraryItems.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line bg-wash px-4 py-10 text-center text-sm text-muted">
              Library laden…
            </p>
          ) : (
            <CreativeLibraryView
              items={libraryItems}
              onChanged={applyLibraryItems}
              onQueued={() => {
                setQueueHighlight((n) => n + 1);
                void loadLibrary();
              }}
            />
          )}

          {(data?.metaCreatives || []).length > 0 ? (
            <section className="rounded-2xl border border-line bg-white px-4 py-3">
              <h3 className="font-display text-base font-semibold text-ink">
                Meta winners (live Ads API)
              </h3>
              <p className="mt-0.5 text-xs text-muted">
                Klik → kies Still of UGC-video → provincie of plaats-gebonden →
                genereer (tijdelijke regeling · bijna gratis)
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {(data?.metaCreatives || []).map((c) => (
                  <button
                    key={c.adId}
                    type="button"
                    onClick={() => setMetaWinner(c)}
                    className="overflow-hidden rounded-xl border border-line text-left transition hover:border-green-dark/50"
                  >
                    <div className="relative aspect-square bg-wash">
                      {c.imageUrl || c.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.imageUrl || c.thumbnailUrl || ""}
                          alt={c.adName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-muted">
                          Geen preview
                        </div>
                      )}
                      <span className="absolute bottom-2 left-2 rounded bg-green-dark px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        Variaties
                      </span>
                    </div>
                    <div className="space-y-1 px-3 py-2.5">
                      <p className="truncate text-xs font-semibold text-ink">
                        {c.adName}
                      </p>
                      <p className="truncate text-[11px] text-muted">
                        {c.title || "—"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : loading ? (
            <p className="text-xs text-muted">
              Meta winners laden op de achtergrond…
            </p>
          ) : (
            <p className="rounded-xl border border-dashed border-line bg-wash px-4 py-3 text-xs text-muted">
              Geen Meta winners beschikbaar (API timeout/config). Library hierboven
              blijft bruikbaar.
            </p>
          )}

          {metaWinner ? (
            <MetaWinnerAlternativesModal
              winner={metaWinner}
              onClose={() => setMetaWinner(null)}
              onGenerated={(items, meta) => {
                applyLibraryItems(items);
                setQueueHighlight((n) => n + 1);
                setStatusMsg(
                  meta?.message ||
                    `${meta?.count ?? items.length} ${
                      meta?.output === "video" ? "UGC-video’s" : "stills"
                    } in queue — zie voortgang bovenaan`
                );
                void loadLibrary();
              }}
            />
          ) : null}
        </div>
      ) : null}

      {tab === "launch" ? (
        libraryLoading && libraryItems.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line bg-wash px-4 py-10 text-center text-sm text-muted">
            Launch drafts laden…
          </p>
        ) : (
        <div className="grid gap-5 lg:grid-cols-5">
          <section className="space-y-4 rounded-2xl border border-line bg-white p-4 lg:col-span-2">
            <h3 className="font-display text-base font-semibold text-ink">
              Launch queue
            </h3>
            <p className="text-xs text-muted">
              Alleen creatives die jij als{" "}
              <strong className="text-ink">“dit is goed”</strong> hebt
              gemarkeerd. Die zijn ook de seed voor de volgende Higgsfield-ronde
              (niet de afgekeurde).
            </p>
            <label className="block text-xs font-semibold text-muted">
              Seed voor volgende varianten
              <select
                className="mt-1 h-9 w-full border border-line bg-white px-2 text-sm text-ink"
                value={winnerId || ""}
                onChange={(e) => setWinnerId(e.target.value || null)}
              >
                {seedWinners.length === 0 ? (
                  <option value="">Geen goedgekeurde seeds</option>
                ) : (
                  seedWinners.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.adName}
                      {i.status === "ready" ? " · launch" : ""}
                    </option>
                  ))
                )}
              </select>
            </label>
            <div className="rounded-xl bg-wash px-3 py-2 text-xs text-muted">
              <p className="font-semibold text-ink">Flow</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                <li>Library: selecteer goede ads</li>
                <li>“Dit is goed → launch draft”</li>
                <li>Hier: seed kiezen · volgende ronde daarop</li>
              </ol>
            </div>
            <button
              type="button"
              disabled
              className="h-10 w-full rounded-xl bg-green-dark text-sm font-semibold text-white opacity-60"
              title="Meta/TikTok write-API volgt"
            >
              Launch naar Meta/TikTok (binnenkort)
            </button>
            <p className="text-[11px] text-muted">
              {launchReady.length} klaar voor launch · publishable blijft uit tot
              write-API live is.
            </p>
          </section>

          <section className="lg:col-span-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-base font-semibold text-ink">
                Goedgekeurd ({launchReady.length})
              </h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={statusBusy || selected.size === 0}
                  onClick={() => void applyStatus("unapprove")}
                  className="h-9 rounded-xl border border-line bg-white px-3 text-xs font-semibold disabled:opacity-40"
                >
                  Terug naar review
                </button>
                <button
                  type="button"
                  disabled
                  className="h-9 rounded-xl bg-[#1877F2]/20 px-3 text-xs font-semibold text-[#1877F2]"
                >
                  Launch {selected.size || launchReady.length} ads
                </button>
              </div>
            </div>
            {launchReady.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line bg-wash px-4 py-10 text-center">
                <p className="text-sm font-semibold text-ink">
                  Nog geen goedgekeurde ads
                </p>
                <p className="mt-1 text-xs text-muted">
                  Ga naar Creative library, selecteer wat wél goed is, en druk{" "}
                  <strong>Dit is goed → launch draft</strong>.
                </p>
                <button
                  type="button"
                  onClick={() => setTab("library")}
                  className="mt-4 h-9 rounded-xl bg-green-dark px-4 text-xs font-semibold text-white"
                >
                  Naar Creative library
                </button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {launchReady.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-line bg-white p-2"
                  >
                    <CreativeCard
                      item={item}
                      selected={selected.has(item.id)}
                      onToggle={() => toggle(item.id)}
                    />
                    <div className="mt-2 space-y-1 px-1 pb-1">
                      <p className="text-[10px] font-semibold uppercase text-muted">
                        Headline
                      </p>
                      <p className="text-xs text-ink">{item.headline}</p>
                      <p className="text-[10px] font-semibold uppercase text-muted">
                        Primary text
                      </p>
                      <p className="line-clamp-4 whitespace-pre-wrap text-[11px] text-muted">
                        {item.primaryText}
                      </p>
                      {item.approvedAt ? (
                        <p className="text-[10px] text-green-dark">
                          Goedgekeurd{" "}
                          {new Date(item.approvedAt).toLocaleString("nl-NL")}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        )
      ) : null}
    </div>
  );
}

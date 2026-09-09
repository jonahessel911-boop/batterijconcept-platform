"use client";

import { useCallback, useEffect, useState } from "react";
import type { Adviseur } from "@/types/database";
import type {
  AttributionMetrics,
  AttributionNode,
  GeoRegionMetrics,
  RapportageMetrics,
  RapportageNode,
} from "@/lib/rapportage";
import type {
  FinancialDashboardData,
  FinancialDateRange,
} from "@/lib/financial-dashboard";
import { formatEuro } from "@/lib/format";
import { FinancialDashboard } from "./FinancialDashboard";
import { RapportageMap } from "./RapportageMap";
import { SalesKpiDashboard } from "./SalesKpiDashboard";
import { BackofficeKpiDashboard } from "./BackofficeKpiDashboard";

type ViewMode =
  | "management"
  | "backoffice"
  | "periode"
  | "attributie"
  | "financial"
  | "map";

function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) {
    const k = n / 1000;
    return `€${k.toLocaleString("nl-NL", {
      minimumFractionDigits: abs >= 10000 ? 0 : 2,
      maximumFractionDigits: 2,
    })}k`;
  }
  return formatEuro(n);
}

function MetricCell({
  value,
  money,
  bold,
  danger,
  warn,
  suffix,
}: {
  value: number;
  money?: boolean;
  bold?: boolean;
  danger?: boolean;
  warn?: boolean;
  suffix?: string;
}) {
  const text = money
    ? formatCompact(value)
    : `${value.toLocaleString("nl-NL", {
        maximumFractionDigits: 1,
      })}${suffix || ""}`;
  return (
    <td
      className={[
        "whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-[13px]",
        bold ? "font-semibold text-ink" : "text-ink",
        danger && value < 0 ? "text-[#C62828]" : "",
        warn && value > 0 ? "text-[#C45A12]" : "",
      ].join(" ")}
    >
      {text}
    </td>
  );
}

function MetricsCells({
  m,
  bold,
}: {
  m: RapportageMetrics;
  bold?: boolean;
}) {
  return (
    <>
      <MetricCell value={m.leads} bold={bold} />
      <MetricCell value={m.brutoAfspraken} bold={bold} />
      <MetricCell value={m.nettoAfspraken} bold={bold} />
      <MetricCell value={m.uitvalPct} bold={bold} suffix="%" warn />
      <MetricCell value={m.deals} bold={bold} />
      <MetricCell value={m.conversieAfspraak} bold={bold} suffix="%" />
      <MetricCell value={m.conversieDeal} bold={bold} suffix="%" />
      <MetricCell value={m.conversieAfspraakSale} bold={bold} suffix="%" />
      <MetricCell value={m.omzet} money bold={bold} />
      <MetricCell value={m.gefactureerdeOmzet} money bold={bold} />
      <MetricCell value={m.betaaldeOmzet} money bold={bold} />
      <MetricCell value={m.projectkosten} money bold={bold} />
      <MetricCell value={m.inkoop} money bold={bold} />
      <MetricCell value={m.winst} money bold={bold} danger />
    </>
  );
}

function AttributionCells({
  m,
  bold,
}: {
  m: AttributionMetrics;
  bold?: boolean;
}) {
  return (
    <>
      <MetricCell value={m.leads} bold={bold} />
      <MetricCell value={m.afspraken} bold={bold} />
      <MetricCell value={m.deals} bold={bold} />
      <MetricCell value={m.conversieAfspraak} bold={bold} suffix="%" />
      <MetricCell value={m.conversieDeal} bold={bold} suffix="%" />
    </>
  );
}

type AttrLevel = "lander" | "campaign" | "ad";

type FlatAttrRow = {
  key: string;
  lander: string;
  campaign?: string;
  ad?: string;
  metrics: AttributionMetrics;
  unknown: boolean;
};

function isUnknownLabel(label: string): boolean {
  return (
    label.startsWith("(geen ") ||
    label === "Onbekend" ||
    label.toLowerCase() === "unknown"
  );
}

/** Lange Meta-IDs inkorten; leesbare namen intact laten. */
function formatAttrLabel(raw: string): { display: string; title: string } {
  const label = raw.trim();
  if (isUnknownLabel(label)) {
    return { display: "Onbekend", title: label };
  }
  // Pure numeric Meta ID
  if (/^\d{10,}$/.test(label)) {
    return {
      display: `…${label.slice(-6)}`,
      title: label,
    };
  }
  if (label.length > 42) {
    return {
      display: `${label.slice(0, 38)}…`,
      title: label,
    };
  }
  return { display: label, title: label };
}

function flattenAttribution(
  tree: AttributionNode[],
  level: AttrLevel
): FlatAttrRow[] {
  const rows: FlatAttrRow[] = [];

  for (const lander of tree) {
    if (level === "lander") {
      rows.push({
        key: lander.key,
        lander: lander.label,
        metrics: lander.metrics,
        unknown: isUnknownLabel(lander.label),
      });
      continue;
    }

    for (const campaign of lander.children || []) {
      if (level === "campaign") {
        rows.push({
          key: campaign.key,
          lander: lander.label,
          campaign: campaign.label,
          metrics: campaign.metrics,
          unknown:
            isUnknownLabel(lander.label) && isUnknownLabel(campaign.label),
        });
        continue;
      }

      const ads = campaign.children;
      if (!ads?.length) {
        rows.push({
          key: `${campaign.key}::geen-ad`,
          lander: lander.label,
          campaign: campaign.label,
          ad: "(geen ad)",
          metrics: campaign.metrics,
          unknown: true,
        });
        continue;
      }
      for (const ad of ads) {
        rows.push({
          key: ad.key,
          lander: lander.label,
          campaign: campaign.label,
          ad: ad.label,
          metrics: ad.metrics,
          unknown: isUnknownLabel(ad.label),
        });
      }
    }
  }

  rows.sort((a, b) => {
    if (a.unknown !== b.unknown) return a.unknown ? 1 : -1;
    if (b.metrics.leads !== a.metrics.leads) {
      return b.metrics.leads - a.metrics.leads;
    }
    return a.key.localeCompare(b.key, "nl");
  });

  return rows;
}

function sumAttributionMetrics(rows: FlatAttrRow[]): AttributionMetrics {
  const leads = rows.reduce((s, r) => s + r.metrics.leads, 0);
  const afspraken = rows.reduce((s, r) => s + r.metrics.afspraken, 0);
  const deals = rows.reduce((s, r) => s + r.metrics.deals, 0);
  return {
    leads,
    afspraken,
    deals,
    conversieAfspraak:
      leads > 0 ? Math.round((afspraken / leads) * 1000) / 10 : 0,
    conversieDeal: leads > 0 ? Math.round((deals / leads) * 1000) / 10 : 0,
  };
}

function AttributionOverview({ tree }: { tree: AttributionNode[] }) {
  const [level, setLevel] = useState<AttrLevel>("lander");
  const rows = flattenAttribution(tree, level);
  const totals = sumAttributionMetrics(
    level === "lander" ? rows : flattenAttribution(tree, "lander")
  );

  const levelButtons: { id: AttrLevel; label: string }[] = [
    { id: "lander", label: "Lander" },
    { id: "campaign", label: "Campaign" },
    { id: "ad", label: "Ad" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Weergave
          </p>
          <div className="mt-1.5 flex gap-1 border border-line p-0.5">
            {levelButtons.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setLevel(b.id)}
                className={[
                  "px-3 py-1.5 text-xs font-semibold transition",
                  level === b.id
                    ? "bg-green text-white"
                    : "bg-white text-muted hover:bg-wash",
                ].join(" ")}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-right">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Leads
            </p>
            <p className="font-display text-lg font-semibold tabular-nums text-ink">
              {totals.leads.toLocaleString("nl-NL")}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Afspraken
            </p>
            <p className="font-display text-lg font-semibold tabular-nums text-ink">
              {totals.afspraken.toLocaleString("nl-NL")}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Deals
            </p>
            <p className="font-display text-lg font-semibold tabular-nums text-ink">
              {totals.deals.toLocaleString("nl-NL")}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Lead → deal
            </p>
            <p className="font-display text-lg font-semibold tabular-nums text-ink">
              {totals.conversieDeal.toLocaleString("nl-NL", {
                maximumFractionDigits: 1,
              })}
              %
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-line bg-[#fafbfa] text-left">
              <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Lander
              </th>
              {(level === "campaign" || level === "ad") && (
                <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Campaign
                </th>
              )}
              {level === "ad" && (
                <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Ad
                </th>
              )}
              {["Leads", "Afspraken", "Deals", "Lead → afspr.", "Lead → deal"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-muted"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={level === "ad" ? 8 : level === "campaign" ? 7 : 6}
                  className="px-4 py-10 text-center text-sm text-muted"
                >
                  Nog geen attributie-data.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const lander = formatAttrLabel(row.lander);
                const campaign = row.campaign
                  ? formatAttrLabel(row.campaign)
                  : null;
                const ad = row.ad ? formatAttrLabel(row.ad) : null;
                return (
                  <tr
                    key={row.key}
                    className={[
                      "border-b border-line",
                      row.unknown ? "bg-[#fafbfa] text-muted" : "bg-white",
                    ].join(" ")}
                  >
                    <td className="max-w-[10rem] px-3 py-2.5">
                      <span
                        className="block truncate text-[13px] font-semibold text-ink"
                        title={lander.title}
                      >
                        {lander.display}
                      </span>
                    </td>
                    {campaign && (
                      <td className="max-w-[16rem] px-3 py-2.5">
                        <span
                          className="block truncate text-[13px] text-ink"
                          title={campaign.title}
                        >
                          {campaign.display}
                        </span>
                      </td>
                    )}
                    {ad && (
                      <td className="max-w-[12rem] px-3 py-2.5">
                        <span
                          className="block truncate text-[13px] text-ink"
                          title={ad.title}
                        >
                          {ad.display}
                        </span>
                      </td>
                    )}
                    <AttributionCells m={row.metrics} />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  node,
  depth,
  open,
  toggle,
}: {
  node: RapportageNode;
  depth: number;
  open: Set<string>;
  toggle: (key: string) => void;
}) {
  const hasChildren = Boolean(node.children?.length);
  const isOpen = open.has(node.key);
  const pad = 8 + depth * 16;

  return (
    <>
      <tr
        className={[
          "border-b border-line",
          hasChildren ? "cursor-pointer hover:bg-[#f7faf8]" : "",
          depth === 0 ? "bg-[#fafbfa]" : "bg-white",
        ].join(" ")}
        onClick={() => hasChildren && toggle(node.key)}
      >
        <td className="px-2 py-2.5 text-left">
          <div
            className="flex items-center gap-1.5"
            style={{ paddingLeft: pad }}
          >
            {hasChildren ? (
              <span className="inline-block w-3 text-[10px] text-muted">
                {isOpen ? "▾" : "▸"}
              </span>
            ) : (
              <span className="inline-block w-3" />
            )}
            <span
              className={[
                "text-[13px]",
                depth === 0 ? "font-semibold text-ink" : "text-ink",
              ].join(" ")}
            >
              {node.label}
            </span>
            {node.isCurrent && (
              <span className="ml-1.5 rounded-sm bg-orange px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                Huidig
              </span>
            )}
          </div>
        </td>
        <MetricsCells m={node.metrics} bold={depth < 2} />
      </tr>
      {hasChildren &&
        isOpen &&
        node.children!.map((child) => (
          <Row
            key={child.key}
            node={child}
            depth={depth + 1}
            open={open}
            toggle={toggle}
          />
        ))}
    </>
  );
}

const PERIODE_HEADERS = [
  "Periode",
  "Leads",
  "Ingepland",
  "Voltooid",
  "% uitval",
  "Deals",
  "Lead → afspr.",
  "Lead → deal",
  "Afspraak → sale",
  "Omzet",
  "Gefactureerde omzet",
  "Betaalde omzet",
  "Installatiekosten",
  "Inkoop",
  "Winst",
] as const;

export function RapportagePanel({
  adviseurs,
  defaultAdviseurId,
}: {
  adviseurs: Adviseur[];
  defaultAdviseurId?: string;
}) {
  const [adviseurId, setAdviseurId] = useState(defaultAdviseurId || "");
  const [view, setView] = useState<ViewMode>("management");
  const [financialRange, setFinancialRange] =
    useState<FinancialDateRange>("last_30_days");
  const [tree, setTree] = useState<RapportageNode[]>([]);
  const [attribution, setAttribution] = useState<AttributionNode[]>([]);
  const [financial, setFinancial] = useState<FinancialDashboardData | null>(
    null
  );
  const [geo, setGeo] = useState<GeoRegionMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metaMsg, setMetaMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (adviseurId) params.set("adviseur_id", adviseurId);
      params.set("financial_range", financialRange);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/rapportage${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setTree(data.tree || []);
      setAttribution(data.attribution || []);
      setFinancial(data.financial || null);
      setGeo(data.geo || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [adviseurId, financialRange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncAllMetaAdSpend() {
    setSyncingMeta(true);
    setMetaMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/meta/ad-spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_sync: true,
          chunk_days: 45,
          time_increment: "1",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.errors?.[0] || "Sync mislukt");
      setMetaMsg(
        `Meta ad spend gesynchroniseerd: ${data.upserted || 0} perioden (${data.since} t/m ${data.until}).`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Meta sync mislukt");
    } finally {
      setSyncingMeta(false);
    }
  }

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedNaam =
    adviseurs.find((a) => a.id === adviseurId)?.naam || null;

  const headers = PERIODE_HEADERS;

  const viewTitle =
    view === "management"
      ? "Managementdashboard"
      : view === "backoffice"
        ? "Backoffice rapportage"
        : view === "periode"
          ? "Periode overzicht"
          : view === "attributie"
            ? "Bronnen"
            : view === "map"
              ? "Kaart"
              : "Financial Dashboard";

  const viewDescription =
    view === "management"
      ? "Directie, marketing, sales, orders en finance — echte data, filters en forecasts."
      : view === "backoffice"
        ? "Time to first contact (werktijd), acties/taken per medewerker, schouw- en aanbetaling-SLA."
        : view === "periode"
          ? "Jaar → maand → week → dag · klik om uit te klappen. Deals + Lead→afspraak/deal = cohort. Voltooid = afgeboekte afspraken die al geweest zijn (geen toekomst). Afspraak→sale = getekende deals ÷ voltooid in de periode."
          : view === "attributie"
            ? "Cohort per lander, campaign of ad: leads → afspraken → deals. Wissel van weergave om dieper te kijken — geen geneste boom meer."
            : view === "map"
              ? "Klik op een provincie om leads, afspraken en deals per gebied te zien (op basis van postcode)."
              : "Omzet, winst, marge, ROI en CAC — met vergelijking t.o.v. de vorige periode.";

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-5">
      <div className="border border-line bg-white">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-display text-base font-semibold text-ink">
                {viewTitle}
              </p>
              <p className="mt-0.5 text-sm text-muted">{viewDescription}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1 border border-line p-0.5">
              <button
                type="button"
                onClick={() => {
                  setView("management");
                  setOpen(new Set());
                }}
                className={[
                  "px-3 py-1.5 text-xs font-semibold transition",
                  view === "management"
                    ? "bg-green text-white"
                    : "bg-white text-muted hover:bg-wash",
                ].join(" ")}
              >
                Dashboard
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("backoffice");
                  setOpen(new Set());
                }}
                className={[
                  "px-3 py-1.5 text-xs font-semibold transition",
                  view === "backoffice"
                    ? "bg-green text-white"
                    : "bg-white text-muted hover:bg-wash",
                ].join(" ")}
              >
                Backoffice
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("periode");
                  setOpen(new Set());
                }}
                className={[
                  "px-3 py-1.5 text-xs font-semibold transition",
                  view === "periode"
                    ? "bg-green text-white"
                    : "bg-white text-muted hover:bg-wash",
                ].join(" ")}
              >
                Periode
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("attributie");
                  setOpen(new Set());
                }}
                className={[
                  "px-3 py-1.5 text-xs font-semibold transition",
                  view === "attributie"
                    ? "bg-green text-white"
                    : "bg-white text-muted hover:bg-wash",
                ].join(" ")}
              >
                Bronnen
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("map");
                  setOpen(new Set());
                }}
                className={[
                  "px-3 py-1.5 text-xs font-semibold transition",
                  view === "map"
                    ? "bg-green text-white"
                    : "bg-white text-muted hover:bg-wash",
                ].join(" ")}
              >
                Kaart
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("financial");
                  setOpen(new Set());
                }}
                className={[
                  "px-3 py-1.5 text-xs font-semibold transition",
                  view === "financial"
                    ? "bg-green text-white"
                    : "bg-white text-muted hover:bg-wash",
                ].join(" ")}
              >
                Financial
              </button>
            </div>
          </div>

          {view !== "management" && view !== "backoffice" && (
            <>
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Verkoopmedewerker
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAdviseurId("")}
              className={[
                "border px-3 py-1.5 text-sm font-medium transition",
                !adviseurId
                  ? "border-green bg-green text-white"
                  : "border-line bg-white text-ink hover:bg-wash",
              ].join(" ")}
            >
              Alles
            </button>
            {adviseurs
              .filter((a) => a.actief)
              .map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAdviseurId(a.id)}
                  className={[
                    "border px-3 py-1.5 text-sm font-medium transition",
                    adviseurId === a.id
                      ? "border-green bg-green text-white"
                      : "border-line bg-white text-ink hover:bg-wash",
                  ].join(" ")}
                >
                  {a.naam}
                </button>
              ))}
          </div>
          <p className="mt-2 text-sm text-muted">
            Toont: {selectedNaam ? selectedNaam : "Alle medewerkers"}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void syncAllMetaAdSpend()}
              disabled={syncingMeta}
              className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-60"
              title="Haalt historische Meta lead-campagne ad spend op (120249296331970109) in week-blokken."
            >
              {syncingMeta ? "Meta sync bezig…" : "Haal alle Meta ad spend op"}
            </button>
            {metaMsg && <p className="text-xs text-green-dark">{metaMsg}</p>}
          </div>
            </>
          )}
          {view === "management" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void syncAllMetaAdSpend()}
                disabled={syncingMeta}
                className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-60"
              >
                {syncingMeta
                  ? "Meta sync bezig…"
                  : "Haal alle Meta ad spend op"}
              </button>
              {metaMsg && <p className="text-xs text-green-dark">{metaMsg}</p>}
            </div>
          )}
        </div>

        {error && (
          <p className="border-b border-line bg-[#FFF0E6] px-4 py-2 text-sm text-[#C45A12]">
            {error}
          </p>
        )}

        {view === "management" ? (
          <SalesKpiDashboard />
        ) : view === "backoffice" ? (
          <BackofficeKpiDashboard />
        ) : view === "financial" ? (
          <FinancialDashboard
            data={financial}
            range={financialRange}
            onRangeChange={setFinancialRange}
            loading={loading}
            adviseurs={adviseurs}
          />
        ) : view === "map" ? (
          loading ? (
            <p className="px-4 py-10 text-center text-sm text-muted">Laden…</p>
          ) : (
            <RapportageMap regions={geo} />
          )
        ) : view === "attributie" ? (
          loading ? (
            <p className="px-4 py-10 text-center text-sm text-muted">Laden…</p>
          ) : (
            <AttributionOverview tree={attribution} />
          )
        ) : loading ? (
          <p className="px-4 py-10 text-center text-sm text-muted">Laden…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse">
              <thead>
                <tr className="border-b border-line bg-[#fafbfa] text-left">
                  {headers.map((h) => (
                    <th
                      key={h}
                      className={[
                        "px-2 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted",
                        h === "Periode" ? "text-left" : "text-right",
                      ].join(" ")}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tree.length === 0 ? (
                  <tr>
                    <td
                      colSpan={headers.length}
                      className="px-4 py-10 text-center text-sm text-muted"
                    >
                      Nog geen data in deze periode.
                    </td>
                  </tr>
                ) : (
                  tree.map((node) => (
                    <Row
                      key={node.key}
                      node={node}
                      depth={0}
                      open={open}
                      toggle={toggle}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import type { Adviseur } from "@/types/database";
import type {
  AttributionMetrics,
  AttributionNode,
  RapportageMetrics,
  RapportageNode,
} from "@/lib/rapportage";
import type {
  FinancialDashboardData,
  FinancialDateRange,
} from "@/lib/financial-dashboard";
import { formatEuro } from "@/lib/format";
import { FinancialDashboard } from "./FinancialDashboard";

type ViewMode = "periode" | "attributie" | "financial";

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
      <MetricCell value={m.omzet} money bold={bold} />
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

function AttributionRow({
  node,
  depth,
  open,
  toggle,
}: {
  node: AttributionNode;
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
            {depth === 0 && hasChildren && (
              <span className="ml-1.5 text-[10px] text-muted">
                {node.children!.length} campaign
                {node.children!.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </td>
        <AttributionCells m={node.metrics} bold={depth === 0} />
      </tr>
      {hasChildren &&
        isOpen &&
        node.children!.map((child) => (
          <AttributionRow
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
  "Netto",
  "% uitval",
  "Deals",
  "Lead → afspr.",
  "Lead → deal",
  "Omzet",
  "Betaalde omzet",
  "Installatiekosten",
  "Inkoop",
  "Winst",
] as const;

const ATTRIBUTION_HEADERS = [
  "Lander / campaign",
  "Leads",
  "Afspraken",
  "Deals",
  "Lead → afspr.",
  "Lead → deal",
] as const;

export function RapportagePanel({
  adviseurs,
  defaultAdviseurId,
}: {
  adviseurs: Adviseur[];
  defaultAdviseurId?: string;
}) {
  const [adviseurId, setAdviseurId] = useState(defaultAdviseurId || "");
  const [view, setView] = useState<ViewMode>("periode");
  const [financialRange, setFinancialRange] =
    useState<FinancialDateRange>("last_30_days");
  const [tree, setTree] = useState<RapportageNode[]>([]);
  const [attribution, setAttribution] = useState<AttributionNode[]>([]);
  const [financial, setFinancial] = useState<FinancialDashboardData | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [adviseurId, financialRange]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const headers =
    view === "periode" ? PERIODE_HEADERS : ATTRIBUTION_HEADERS;
  const rows = view === "periode" ? tree : attribution;

  const viewTitle =
    view === "periode"
      ? "Periode overzicht"
      : view === "attributie"
        ? "Lander & campaign"
        : "Financial Dashboard";

  const viewDescription =
    view === "periode"
      ? "Jaar → maand → week → dag · klik om uit te klappen. Ingepland/netto en Lead→afspraak op het moment dat de afspraak is ingepland (niet lead-aanmaakdatum of bezoekdatum)."
      : view === "attributie"
        ? "Lander → campaign · cohort: van de leads uit deze bron, hoeveel kregen een afspraak en hoeveel deals (ondertekende offertes). Campaign valt terug op utm_campaign als campaign_name leeg is."
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
                Lander / campaign
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
                Financial Dashboard
              </button>
            </div>
          </div>

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
        </div>

        {error && (
          <p className="border-b border-line bg-[#FFF0E6] px-4 py-2 text-sm text-[#C45A12]">
            {error}
          </p>
        )}

        {view === "financial" ? (
          <FinancialDashboard
            data={financial}
            range={financialRange}
            onRangeChange={setFinancialRange}
            loading={loading}
            adviseurs={adviseurs}
          />
        ) : loading ? (
          <p className="px-4 py-10 text-center text-sm text-muted">Laden…</p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className={[
                "w-full border-collapse",
                view === "periode" ? "min-w-[1100px]" : "min-w-[640px]",
              ].join(" ")}
            >
              <thead>
                <tr className="border-b border-line bg-[#fafbfa] text-left">
                  {headers.map((h) => (
                    <th
                      key={h}
                      className={[
                        "px-2 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted",
                        h === "Periode" || h === "Lander / campaign"
                          ? "text-left"
                          : "text-right",
                      ].join(" ")}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={headers.length}
                      className="px-4 py-10 text-center text-sm text-muted"
                    >
                      {view === "periode"
                        ? "Nog geen data in deze periode."
                        : "Nog geen leads met lander/campaign-data."}
                    </td>
                  </tr>
                ) : view === "periode" ? (
                  tree.map((node) => (
                    <Row
                      key={node.key}
                      node={node}
                      depth={0}
                      open={open}
                      toggle={toggle}
                    />
                  ))
                ) : (
                  attribution.map((node) => (
                    <AttributionRow
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

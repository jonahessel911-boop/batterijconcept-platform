"use client";

import { useCallback, useEffect, useState } from "react";
import type { Adviseur } from "@/types/database";
import type { RapportageNode, RapportageMetrics } from "@/lib/rapportage";
import { formatEuro } from "@/lib/format";

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
  suffix,
}: {
  value: number;
  money?: boolean;
  bold?: boolean;
  danger?: boolean;
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
      <MetricCell value={m.deals} bold={bold} />
      <MetricCell value={m.conversie} bold={bold} suffix="%" />
      <MetricCell value={m.bemVol} money bold={bold} />
      <MetricCell value={m.omzet} money bold={bold} />
      <MetricCell value={m.omzetPerDeal} money bold={bold} />
      <MetricCell value={m.projectkosten} money bold={bold} />
      <MetricCell value={m.salesKosten} money bold={bold} />
      <MetricCell value={m.adSpend} money bold={bold} />
      <MetricCell value={m.winst} money bold={bold} danger />
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

export function RapportagePanel({
  adviseurs,
  defaultAdviseurId,
}: {
  adviseurs: Adviseur[];
  defaultAdviseurId?: string;
}) {
  const [adviseurId, setAdviseurId] = useState(defaultAdviseurId || "");
  const [tree, setTree] = useState<RapportageNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Kosten snel invoeren
  const [kostenDatum, setKostenDatum] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [adSpend, setAdSpend] = useState("");
  const [salesKosten, setSalesKosten] = useState("");
  const [savingKosten, setSavingKosten] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = adviseurId
        ? `?adviseur_id=${encodeURIComponent(adviseurId)}`
        : "";
      const res = await fetch(`/api/rapportage${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setTree(data.tree || []);
      // Open huidig jaar standaard
      const current = (data.tree || []).find(
        (n: RapportageNode) => n.isCurrent
      );
      if (current) {
        setOpen((prev) => new Set([...prev, current.key]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [adviseurId]);

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

  async function saveKosten() {
    setSavingKosten(true);
    setError(null);
    try {
      const jobs = [];
      if (adSpend !== "") {
        jobs.push(
          fetch("/api/rapportage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              datum: kostenDatum,
              soort: "ad_spend",
              bedrag: Number(adSpend),
              adviseur_id: adviseurId || null,
            }),
          })
        );
      }
      if (salesKosten !== "") {
        jobs.push(
          fetch("/api/rapportage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              datum: kostenDatum,
              soort: "sales",
              bedrag: Number(salesKosten),
              adviseur_id: adviseurId || null,
            }),
          })
        );
      }
      for (const p of jobs) {
        const res = await p;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      }
      setAdSpend("");
      setSalesKosten("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setSavingKosten(false);
    }
  }

  const selectedNaam =
    adviseurs.find((a) => a.id === adviseurId)?.naam || null;

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-5">
      <div className="border border-line bg-white">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <p className="font-display text-base font-semibold text-ink">
            Periode overzicht
          </p>
          <p className="mt-0.5 text-sm text-muted">
            Jaar → maand → week → dag · klik om uit te klappen
          </p>
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

        {/* Kosten invoer */}
        <div className="grid gap-3 border-b border-line bg-wash/50 px-4 py-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end sm:px-5">
          <label className="text-xs font-medium text-muted">
            Datum
            <input
              type="date"
              value={kostenDatum}
              onChange={(e) => setKostenDatum(e.target.value)}
              className="mt-1 block w-full border border-line bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-green"
            />
          </label>
          <label className="text-xs font-medium text-muted">
            Ad spend (€)
            <input
              type="number"
              min={0}
              step="0.01"
              value={adSpend}
              onChange={(e) => setAdSpend(e.target.value)}
              placeholder="0,00"
              className="mt-1 block w-full border border-line bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-green"
            />
          </label>
          <label className="text-xs font-medium text-muted">
            Sales kosten (€)
            <input
              type="number"
              min={0}
              step="0.01"
              value={salesKosten}
              onChange={(e) => setSalesKosten(e.target.value)}
              placeholder="0,00"
              className="mt-1 block w-full border border-line bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-green"
            />
          </label>
          <button
            type="button"
            disabled={savingKosten || (adSpend === "" && salesKosten === "")}
            onClick={saveKosten}
            className="bg-orange px-4 py-2 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50"
          >
            {savingKosten ? "Opslaan…" : "Kosten opslaan"}
          </button>
        </div>

        {error && (
          <p className="border-b border-line bg-[#FFF0E6] px-4 py-2 text-sm text-[#C45A12]">
            {error}
          </p>
        )}

        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-muted">Laden…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse">
              <thead>
                <tr className="border-b border-line bg-[#fafbfa] text-left">
                  {[
                    "Periode",
                    "Leads",
                    "Deals",
                    "Conversie",
                    "Bem. vol",
                    "Omzet",
                    "Omzet / deal",
                    "Projectkosten",
                    "Sales kosten",
                    "Ad spend",
                    "Winst",
                  ].map((h) => (
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
                      colSpan={11}
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

        <p className="border-t border-line px-4 py-3 text-[11px] text-muted sm:px-5">
          Omzet = omzet excl. btw − projectkosten. Winst = omzet excl. btw −
          projectkosten − ad spend − sales kosten. Projectkosten vul je in op
          het project.
        </p>
      </div>
    </div>
  );
}

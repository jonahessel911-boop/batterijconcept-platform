"use client";

import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import type { GeoRegionMetrics } from "@/lib/rapportage";
import { normalizeProvincieLabel, PROVINCIE_ONBEKEND } from "@/lib/postcode-provincie";
import { formatEuro } from "@/lib/format";

const GEO_URL = "/geo/NL.geojson";

type Props = {
  regions: GeoRegionMetrics[];
};

function heatColor(leads: number, max: number): string {
  if (max <= 0 || leads <= 0) return "#e8eee9";
  const t = Math.min(1, leads / max);
  // licht mint → brand green
  if (t < 0.25) return "#cfe8d4";
  if (t < 0.5) return "#8fbf9a";
  if (t < 0.75) return "#4a8f5c";
  return "#1f6b3a";
}

export function RapportageMap({ regions }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const byLabel = useMemo(() => {
    const m = new Map<string, GeoRegionMetrics>();
    for (const r of regions) m.set(r.label, r);
    return m;
  }, [regions]);

  const maxLeads = useMemo(
    () => Math.max(0, ...regions.filter((r) => r.key !== PROVINCIE_ONBEKEND).map((r) => r.leads)),
    [regions]
  );

  const activeKey = selected || hover;
  const active = activeKey ? byLabel.get(activeKey) : null;

  const totals = useMemo(() => {
    return regions.reduce(
      (acc, r) => {
        if (r.key === PROVINCIE_ONBEKEND) return acc;
        acc.leads += r.leads;
        acc.afspraken += r.afspraken;
        acc.deals += r.deals;
        acc.omzet += r.omzet;
        return acc;
      },
      { leads: 0, afspraken: 0, deals: 0, omzet: 0 }
    );
  }, [regions]);

  const unknown = byLabel.get(PROVINCIE_ONBEKEND);

  function metricsForGeoName(name: string): GeoRegionMetrics | undefined {
    const label = normalizeProvincieLabel(name);
    return byLabel.get(label);
  }

  return (
    <div className="grid gap-0 lg:grid-cols-[1fr_280px]">
      <div className="min-w-0 border-b border-line p-4 lg:border-b-0 lg:border-r">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          Nederland · provincies
        </p>
        <p className="mt-1 text-sm text-muted">
          Klik op een provincie voor leads, afspraken en deals. Kleur = aantal
          leads.
        </p>

        <div className="mx-auto mt-3 w-full max-w-[640px]">
          <ComposableMap
            projection="geoMercator"
            projectionConfig={{ scale: 7500, center: [5.3, 52.15] }}
            width={640}
            height={720}
            style={{ width: "100%", height: "auto" }}
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  const rawName = String(
                    geo.properties?.statnaam ||
                      geo.properties?.name ||
                      "Unknown"
                  );
                  const label = normalizeProvincieLabel(rawName);
                  const m = metricsForGeoName(rawName);
                  const leads = m?.leads || 0;
                  const isActive = activeKey === label;
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      onClick={() =>
                        setSelected((prev) => (prev === label ? null : label))
                      }
                      onMouseEnter={() => setHover(label)}
                      onMouseLeave={() => setHover(null)}
                      style={{
                        default: {
                          fill: isActive ? "#f37021" : heatColor(leads, maxLeads),
                          stroke: isActive ? "#c45a12" : "#1f6b3a",
                          strokeWidth: isActive ? 1.6 : 0.9,
                          outline: "none",
                          cursor: "pointer",
                          transition: "fill 0.12s",
                        },
                        hover: {
                          fill: isActive ? "#f37021" : "#f37021aa",
                          stroke: "#c45a12",
                          strokeWidth: 1.4,
                          outline: "none",
                          cursor: "pointer",
                        },
                        pressed: {
                          fill: "#f37021",
                          outline: "none",
                        },
                      }}
                    />
                  );
                })
              }
            </Geographies>
          </ComposableMap>
        </div>
      </div>

      <aside className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          {active ? active.label : "Heel Nederland"}
        </p>

        <div className="mt-3 space-y-3">
          <Stat
            label="Leads"
            value={(active?.leads ?? totals.leads).toLocaleString("nl-NL")}
          />
          <Stat
            label="Afspraken"
            value={(active?.afspraken ?? totals.afspraken).toLocaleString(
              "nl-NL"
            )}
          />
          <Stat
            label="Deals"
            value={(active?.deals ?? totals.deals).toLocaleString("nl-NL")}
          />
          <Stat
            label="Omzet"
            value={formatEuro(active?.omzet ?? totals.omzet)}
          />
          {active && (
            <>
              <Stat
                label="Lead → afspraak"
                value={`${active.conversieAfspraak.toLocaleString("nl-NL", {
                  maximumFractionDigits: 1,
                })}%`}
              />
              <Stat
                label="Lead → deal"
                value={`${active.conversieDeal.toLocaleString("nl-NL", {
                  maximumFractionDigits: 1,
                })}%`}
              />
            </>
          )}
        </div>

        {unknown && unknown.leads > 0 && (
          <p className="mt-4 text-xs text-muted">
            {unknown.leads} lead{unknown.leads === 1 ? "" : "s"} zonder
            bruikbare postcode (niet op de kaart).
          </p>
        )}

        <div className="mt-5 border-t border-line pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Top provincies
          </p>
          <ul className="mt-2 space-y-1.5">
            {regions
              .filter((r) => r.key !== PROVINCIE_ONBEKEND && r.leads > 0)
              .slice(0, 6)
              .map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.label)}
                    className={[
                      "flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm transition",
                      selected === r.label
                        ? "bg-green/10 font-semibold text-green-dark"
                        : "text-ink hover:bg-wash",
                    ].join(" ")}
                  >
                    <span className="truncate">{r.label}</span>
                    <span className="tabular-nums text-muted">
                      {r.leads} · {r.afspraken} · {r.deals}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
          <p className="mt-2 text-[10px] text-muted">leads · afspraken · deals</p>
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="font-display text-xl font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}

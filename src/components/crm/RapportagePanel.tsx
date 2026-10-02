"use client";

import { useCallback, useEffect, useState } from "react";
import type { GeoRegionMetrics } from "@/lib/rapportage";
import { RapportageMap } from "./RapportageMap";
import { DashboardV2 } from "./DashboardV2";

type ViewMode = "dashboard_v2" | "map";

export function RapportagePanel() {
  const [view, setView] = useState<ViewMode>("dashboard_v2");
  const [geo, setGeo] = useState<GeoRegionMetrics[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMap = useCallback(async () => {
    setMapLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rapportage");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setGeo(data.geo || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setMapLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "map") return;
    void loadMap();
  }, [view, loadMap]);

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-5">
      <div className="border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <p className="font-display text-base font-semibold text-ink">
              {view === "dashboard_v2" ? "Dashboard" : "Kaart"}
            </p>
            <p className="mt-0.5 text-sm text-muted">
              {view === "dashboard_v2"
                ? "Stand vs doel: waar staan we, en wat moet er nog bij."
                : "Klik op een provincie voor leads, afspraken en deals."}
            </p>
          </div>
          <div className="flex shrink-0 gap-1 border border-line p-0.5">
            {(
              [
                ["dashboard_v2", "Dashboard"],
                ["map", "Kaart"],
              ] as const
            ).map(([id, label]) => (
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
          </div>
        </div>

        {error ? (
          <p className="border-b border-line bg-[#FFF0E6] px-4 py-2 text-sm text-[#C45A12]">
            {error}
          </p>
        ) : null}

        {view === "dashboard_v2" ? (
          <div className="bg-wash/40 px-4 py-5 sm:px-5">
            <DashboardV2 />
          </div>
        ) : mapLoading ? (
          <p className="px-4 py-10 text-center text-sm text-muted">Laden…</p>
        ) : (
          <RapportageMap regions={geo} />
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import { loadGoogleMaps } from "@/lib/google-maps";
import type { AdviseurDekkingResult } from "@/lib/adviseur-dekking";
import { regionPolygonFromPoints } from "@/lib/geo-hull";

type MonthOpt = { jaar: number; maand: number; label: string };
type MapView = "adviseurs" | "leadflow";

function monthOptions(count = 12): MonthOpt[] {
  const now = new Date();
  const out: MonthOpt[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      jaar: d.getFullYear(),
      maand: d.getMonth() + 1,
      label: d.toLocaleDateString("nl-NL", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

const COLORS = [
  "#0D5C32",
  "#1565C0",
  "#C45A12",
  "#6A1B9A",
  "#00695C",
  "#AD1457",
  "#455A64",
  "#F9A825",
];

export function AdviseursKaartPanel() {
  const now = new Date();
  const [jaar, setJaar] = useState(
    Number(formatInTimeZone(now, AMSTERDAM_TZ, "yyyy"))
  );
  const [maand, setMaand] = useState(
    Number(formatInTimeZone(now, AMSTERDAM_TZ, "M"))
  );
  const [view, setView] = useState<MapView>("adviseurs");
  const [data, setData] = useState<AdviseurDekkingResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const circlesRef = useRef<google.maps.Circle[]>([]);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const fittedKey = useRef<string>("");

  const months = monthOptions();

  const colorByAdviseur = useMemo(() => {
    const m = new Map<string, string>();
    (data?.adviseurs || []).forEach((a, idx) => {
      m.set(a.id, COLORS[idx % COLORS.length]);
    });
    return m;
  }, [data?.adviseurs]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/rapportage/adviseur-dekking?jaar=${jaar}&maand=${maand}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Laden mislukt"
        );
      }
      setData(json as AdviseurDekkingResult);
      fittedKey.current = "";
      if (!(json as AdviseurDekkingResult).adviseurs?.length) {
        setSelectedId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [jaar, maand]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadGoogleMaps();
        if (cancelled || !mapEl.current) return;
        if (!mapRef.current) {
          mapRef.current = new google.maps.Map(mapEl.current, {
            center: { lat: 52.15, lng: 5.3 },
            zoom: 7.4,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
            styles: [
              {
                featureType: "poi",
                stylers: [{ visibility: "off" }],
              },
            ],
          });
        }
        setMapReady(true);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "Google Maps kon niet worden geladen"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !data) return;

    for (const c of circlesRef.current) c.setMap(null);
    for (const m of markersRef.current) m.setMap(null);
    for (const p of polygonsRef.current) p.setMap(null);
    circlesRef.current = [];
    markersRef.current = [];
    polygonsRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    let hasPoint = false;

    data.adviseurs.forEach((a) => {
      const color = colorByAdviseur.get(a.id) || COLORS[0];
      const pos = { lat: a.lat, lng: a.lon };
      bounds.extend(pos);
      hasPoint = true;

      const isSelected = selectedId == null || selectedId === a.id;

      if (view === "adviseurs") {
        const circle = new google.maps.Circle({
          map,
          center: pos,
          radius: data.radiusM,
          strokeColor: color,
          strokeOpacity: isSelected ? 0.85 : 0.3,
          strokeWeight: isSelected ? 2 : 1,
          fillColor: color,
          fillOpacity: isSelected ? 0.14 : 0.05,
          clickable: true,
        });
        circle.addListener("click", () => setSelectedId(a.id));
        circlesRef.current.push(circle);

        const marker = new google.maps.Marker({
          map,
          position: pos,
          title: a.naam,
          label: {
            text: a.initialen || "?",
            color: "#fff",
            fontSize: "11px",
            fontWeight: "700",
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 16,
            fillColor: color,
            fillOpacity: isSelected ? 1 : 0.5,
            strokeColor: "#fff",
            strokeWeight: 2,
          },
          zIndex: 20,
        });
        marker.addListener("click", () => setSelectedId(a.id));
        markersRef.current.push(marker);
      } else {
        // Leadflow: regio-vlak van leads (convex hull), geen losse punten
        if (selectedId && selectedId !== a.id) return;

        const leadPts = data.leadPoints
          .filter((p) => p.adviseurId === a.id)
          .map((p) => ({ lat: p.lat, lon: p.lon }));
        // Bind regio aan startadres + leads
        const polyPts = regionPolygonFromPoints([
          { lat: a.lat, lon: a.lon },
          ...leadPts,
        ]);

        if (polyPts && polyPts.length >= 3) {
          const path = polyPts.map((p) => ({ lat: p.lat, lng: p.lon }));
          for (const pt of path) bounds.extend(pt);
          const polygon = new google.maps.Polygon({
            map,
            paths: path,
            strokeColor: color,
            strokeOpacity: isSelected ? 0.95 : 0.55,
            strokeWeight: isSelected ? 2.5 : 1.5,
            fillColor: color,
            fillOpacity: isSelected ? 0.35 : 0.22,
            clickable: true,
            zIndex: isSelected ? 5 : 2,
          });
          polygon.addListener("click", () => setSelectedId(a.id));
          polygonsRef.current.push(polygon);
        } else if (a.leadsInStraal > 0) {
          // Fallback: 1u-cirkel als regio als hull te klein is
          const circle = new google.maps.Circle({
            map,
            center: pos,
            radius: data.radiusM,
            strokeColor: color,
            strokeOpacity: 0.7,
            strokeWeight: 2,
            fillColor: color,
            fillOpacity: 0.22,
            clickable: true,
          });
          circle.addListener("click", () => setSelectedId(a.id));
          circlesRef.current.push(circle);
        }

        const marker = new google.maps.Marker({
          map,
          position: pos,
          title: `${a.naam} · ${a.leadsInStraal} leads`,
          label: {
            text: a.initialen || "?",
            color: "#fff",
            fontSize: "10px",
            fontWeight: "700",
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 2,
          },
          zIndex: 30,
        });
        marker.addListener("click", () => setSelectedId(a.id));
        markersRef.current.push(marker);
      }
    });

    if (view === "leadflow" && !selectedId) {
      const uncovered = data.leadPoints
        .filter((p) => !p.adviseurId)
        .map((p) => ({ lat: p.lat, lon: p.lon }));
      const uncoveredPoly = regionPolygonFromPoints(uncovered);
      if (uncoveredPoly && uncoveredPoly.length >= 3) {
        const path = uncoveredPoly.map((p) => ({ lat: p.lat, lng: p.lon }));
        for (const pt of path) bounds.extend(pt);
        const polygon = new google.maps.Polygon({
          map,
          paths: path,
          strokeColor: "#C62828",
          strokeOpacity: 0.55,
          strokeWeight: 1.5,
          fillColor: "#C62828",
          fillOpacity: 0.12,
          clickable: false,
          zIndex: 1,
        });
        polygonsRef.current.push(polygon);
      }
    }

    const fitKey = `${jaar}-${maand}-${view}`;
    if (hasPoint && fittedKey.current !== fitKey) {
      map.fitBounds(bounds, 48);
      fittedKey.current = fitKey;
    }
  }, [data, mapReady, selectedId, view, colorByAdviseur, jaar, maand]);

  const selected = data?.adviseurs.find((a) => a.id === selectedId) || null;
  const pctCovered =
    data && data.leadsGeocodeerd > 0
      ? Math.round((data.leadsCovered / data.leadsGeocodeerd) * 1000) / 10
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold text-ink">
            Adviseurs · dekking
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {view === "adviseurs"
              ? "Adviseurs op startadres met 1u-rijden straal."
              : "Leadflow: leads samengevoegd tot regio’s per adviseur (geen losse punten)."}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(
              [
                { id: "adviseurs", label: "Adviseurs" },
                { id: "leadflow", label: "Leadflow" },
              ] as const
            ).map((t) => {
              const active = view === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setView(t.id);
                    fittedKey.current = "";
                  }}
                  className={[
                    "border px-3 py-1.5 text-[11px] font-semibold",
                    active
                      ? "border-green bg-green text-white"
                      : "border-line bg-white text-ink hover:bg-wash",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
        <label className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
          Maand
          <select
            value={`${jaar}-${maand}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              setJaar(y);
              setMaand(m);
            }}
            className="mt-1 block border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
          >
            {months.map((m) => (
              <option
                key={`${m.jaar}-${m.maand}`}
                value={`${m.jaar}-${m.maand}`}
              >
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="mx-5 mt-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
          {error}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[320px_1fr]">
        <aside className="min-h-0 overflow-y-auto border-b border-line lg:border-b-0 lg:border-r">
          <div className="space-y-2 border-b border-line px-4 py-3 text-sm">
            {loading ? (
              <p className="text-muted">Dekking berekenen…</p>
            ) : data ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
                  {data.label}
                </p>
                {view === "leadflow" ? (
                  <>
                    <p className="text-ink">
                      <span className="font-semibold tabular-nums">
                        {data.leadsCovered}
                      </span>
                      <span className="text-muted">
                        {" "}
                        / {data.leadsGeocodeerd} leads in een regio
                      </span>
                      {pctCovered != null ? (
                        <span className="text-muted"> · {pctCovered}%</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted">
                      {data.leadsUncovered} buiten alle stralen (rood)
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted">
                    {data.adviseurs.length} adviseurs met startadres · cirkel ≈
                    1u rijden
                  </p>
                )}
              </>
            ) : (
              <p className="text-muted">Geen data</p>
            )}
          </div>

          <ul className="divide-y divide-line">
            {(data?.adviseurs || []).map((a) => {
              const active = selectedId === a.id;
              const color = colorByAdviseur.get(a.id) || COLORS[0];
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedId((prev) => (prev === a.id ? null : a.id))
                    }
                    className={[
                      "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-wash",
                      active ? "bg-wash" : "",
                    ].join(" ")}
                  >
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ background: color }}
                      aria-hidden
                    >
                      {a.initialen}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {a.naam}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {a.startAdres}
                      </span>
                    </span>
                    {view === "leadflow" ? (
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums text-ink">
                          {a.leadsInStraal}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-muted">
                          leads
                        </span>
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
            {!loading && data && data.adviseurs.length === 0 ? (
              <li className="px-4 py-6 text-sm text-muted">
                Geen actieve adviseurs met bruikbaar startadres.
              </li>
            ) : null}
          </ul>

          {selected ? (
            <div className="border-t border-line bg-[#FAFBFA] px-4 py-3 text-sm">
              <p className="font-semibold text-ink">
                {selected.initialen} · {selected.naam}
              </p>
              <p className="mt-1 text-xs text-muted">{selected.startAdres}</p>
              {view === "leadflow" ? (
                <p className="mt-2 text-ink">
                  <span className="font-semibold tabular-nums">
                    {selected.leadsInStraal}
                  </span>{" "}
                  leads deze maand in deze regio
                </p>
              ) : null}
            </div>
          ) : null}
        </aside>

        <div className="relative min-h-[420px] bg-[#eef2ef]">
          <div ref={mapEl} className="absolute inset-0" />
          <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap gap-2">
            <span className="border border-line bg-white/95 px-2.5 py-1.5 text-[11px] text-muted shadow-sm">
              {view === "adviseurs"
                ? `Initialen · cirkel ≈ 1u (~${Math.round((data?.radiusM || 35600) / 1000)} km)`
                : "Leadflow · gekleurde vlakken = leadregio per adviseur · rood = buiten dekking"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

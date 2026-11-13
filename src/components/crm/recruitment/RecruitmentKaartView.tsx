"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";
import {
  RECRUITMENT_ROL_LABEL,
  type RecruitmentKaartPin,
} from "@/lib/recruitment-rollen";
import type { RecruitmentRol } from "@/types/database";

type LayerFilter = "" | "hq" | "adviseur" | "monteur" | RecruitmentRol;

const LAYER_COLOR: Record<string, string> = {
  hq: "#0B3D2E",
  adviseur: "#1565C0",
  monteur: "#0F766E",
  installateur: "#0D5C32",
  am_maintenance: "#7C3AED",
  bezorger: "#C45A12",
  overig: "#6B7280",
};

function layerKey(p: RecruitmentKaartPin): string {
  if (p.kind === "hq") return "hq";
  if (p.kind === "adviseur") return "adviseur";
  if (p.kind === "monteur") return "monteur";
  return p.rol;
}

function initials(naam: string) {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function hqIcon(): google.maps.Icon {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="80" viewBox="0 0 64 80">
      <path fill="#0B3D2E" d="M32 0C18 0 7 11 7 25c0 18 25 55 25 55s25-37 25-55C57 11 46 0 32 0z"/>
      <circle cx="32" cy="25" r="14" fill="#fff"/>
      <text x="32" y="30" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="700" fill="#0B3D2E">HQ</text>
    </svg>`
  );
  return {
    url: `data:image/svg+xml,${svg}`,
    scaledSize: new google.maps.Size(48, 60),
    anchor: new google.maps.Point(24, 58),
  };
}

export function RecruitmentKaartView() {
  const [pins, setPins] = useState<RecruitmentKaartPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>("hq-daltonlaan");
  const [layer, setLayer] = useState<LayerFilter>("");
  const [listOpen, setListOpen] = useState(true);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const fittedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/instroom/kaart");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Kaart laden mislukt");
      setPins((json.pins || []) as RecruitmentKaartPin[]);
      fittedRef.current = false;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setPins([]);
    } finally {
      setLoading(false);
    }
  }, []);

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
            center: { lat: 52.0875, lng: 5.1686 },
            zoom: 8,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
            zoomControl: true,
            gestureHandling: "greedy",
            styles: [
              { featureType: "poi", stylers: [{ visibility: "off" }] },
              {
                featureType: "transit",
                stylers: [{ visibility: "simplified" }],
              },
            ],
          });
        }
        setMapReady(true);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Google Maps laden mislukt"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    if (!layer) return pins;
    return pins.filter((p) => {
      // HQ blijft altijd zichtbaar als oriëntatiepunt
      if (p.kind === "hq") return true;
      if (layer === "hq") return false;
      if (layer === "adviseur") return p.kind === "adviseur";
      if (layer === "monteur") {
        return p.kind === "monteur" || p.rol === "monteur";
      }
      return p.rol === layer;
    });
  }, [pins, layer]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    let hasBounds = false;

    for (const pin of visible) {
      const lat = Number(pin.lat);
      const lng = Number(pin.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const position = { lat, lng };
      const key = layerKey(pin);
      const color = LAYER_COLOR[key] || LAYER_COLOR.overig;
      const isSelected = selectedId === pin.id;

      let marker: google.maps.Marker;
      if (pin.kind === "hq") {
        marker = new google.maps.Marker({
          map,
          position,
          title: pin.naam,
          icon: hqIcon(),
          zIndex: 1000,
          optimized: false,
        });
      } else if (pin.kind === "adviseur" || pin.kind === "monteur") {
        marker = new google.maps.Marker({
          map,
          position,
          title: pin.naam,
          label: {
            text: initials(pin.naam),
            color: "#fff",
            fontSize: "10px",
            fontWeight: "700",
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: isSelected ? 18 : 15,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2.5,
          },
          zIndex: isSelected ? 200 : 50,
        });
      } else {
        marker = new google.maps.Marker({
          map,
          position,
          title: pin.naam,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: pin.aangenomen ? (isSelected ? 11 : 8) : isSelected ? 9 : 6,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          zIndex: isSelected ? 150 : 20,
        });
      }

      marker.addListener("click", () => {
        setSelectedId(pin.id);
        setListOpen(true);
      });
      markersRef.current.push(marker);
      bounds.extend(position);
      hasBounds = true;
    }

    if (hasBounds && !fittedRef.current) {
      map.fitBounds(bounds, { top: 72, right: 320, bottom: 48, left: 48 });
      fittedRef.current = true;
      // HQ iets prominenter in beeld houden
      const hq = visible.find((p) => p.kind === "hq");
      if (hq) {
        window.setTimeout(() => {
          const z = map.getZoom() || 8;
          if (z > 9) map.setZoom(9);
        }, 80);
      }
    }
  }, [mapReady, visible, selectedId]);

  const selected = visible.find((p) => p.id === selectedId) || null;

  const counts = useMemo(() => {
    const c = {
      hq: 0,
      adviseur: 0,
      monteur: 0,
      installateur: 0,
      am_maintenance: 0,
      bezorger: 0,
      overig: 0,
    };
    for (const p of pins) {
      const k = layerKey(p);
      if (k in c) c[k as keyof typeof c] += 1;
    }
    return c;
  }, [pins]);

  function focusPin(pin: RecruitmentKaartPin) {
    const lat = Number(pin.lat);
    const lng = Number(pin.lng);
    setSelectedId(pin.id);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    mapRef.current?.panTo({ lat, lng });
    mapRef.current?.setZoom(
      pin.kind === "hq" ? 12 : Math.max(mapRef.current.getZoom() || 8, 11)
    );
  }

  return (
    <div className="-mx-1 flex flex-col gap-0 sm:-mx-2">
      <div className="relative h-[min(78vh,820px)] min-h-[520px] overflow-hidden border border-line bg-[#e8eee9]">
        <div ref={mapEl} className="absolute inset-0" />

        {/* Top toolbar overlay */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-3 sm:p-4">
          <div className="pointer-events-auto flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-md border border-line bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
              <p className="font-display text-lg tracking-tight text-ink">
                Teamkaart
              </p>
              <p className="mt-0.5 text-xs text-muted">
                HQ · adviseurs · monteurs · AM Maintenance · bezorgers
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const hq = pins.find((p) => p.kind === "hq");
                  if (hq) focusPin(hq);
                }}
                className="border border-line bg-white px-3 py-2 text-xs font-semibold text-ink shadow-sm hover:bg-wash"
              >
                HQ groot
              </button>
              <button
                type="button"
                onClick={() => setListOpen((v) => !v)}
                className="border border-line bg-white px-3 py-2 text-xs font-semibold text-ink shadow-sm hover:bg-wash md:hidden"
              >
                {listOpen ? "Lijst dicht" : "Lijst"}
              </button>
              <button
                type="button"
                onClick={() => {
                  fittedRef.current = false;
                  void load();
                }}
                className="border border-line bg-white px-3 py-2 text-xs font-semibold text-ink shadow-sm hover:bg-wash"
              >
                Vernieuwen
              </button>
            </div>
          </div>

          <div className="pointer-events-auto mt-3 flex flex-wrap gap-1.5">
            {(
              [
                ["", "Alles", pins.length],
                ["hq", "HQ", counts.hq],
                ["adviseur", "Adviseurs", counts.adviseur],
                ["monteur", RECRUITMENT_ROL_LABEL.monteur, counts.monteur],
                [
                  "am_maintenance",
                  RECRUITMENT_ROL_LABEL.am_maintenance,
                  counts.am_maintenance,
                ],
                [
                  "installateur",
                  RECRUITMENT_ROL_LABEL.installateur,
                  counts.installateur,
                ],
                ["bezorger", RECRUITMENT_ROL_LABEL.bezorger, counts.bezorger],
                ["overig", RECRUITMENT_ROL_LABEL.overig, counts.overig],
              ] as const
            ).map(([key, label, n]) => {
              const active = layer === key;
              const color =
                key === ""
                  ? "#0D5C32"
                  : LAYER_COLOR[key] || LAYER_COLOR.overig;
              return (
                <button
                  key={key || "all"}
                  type="button"
                  onClick={() => setLayer(key as LayerFilter)}
                  className={[
                    "inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-xs font-semibold shadow-sm transition",
                    active
                      ? "border-transparent text-white"
                      : "border-line bg-white/95 text-ink hover:bg-wash",
                  ].join(" ")}
                  style={active ? { background: color } : undefined}
                >
                  {key ? (
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{
                        background: active ? "#fff" : color,
                      }}
                    />
                  ) : null}
                  {label}
                  <span
                    className={[
                      "tabular-nums",
                      active ? "text-white/80" : "text-muted",
                    ].join(" ")}
                  >
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="absolute inset-0 z-[5] flex items-center justify-center bg-white/55 text-sm text-muted">
            Locaties laden…
          </div>
        ) : null}

        {error ? (
          <div className="absolute bottom-4 left-4 z-10 max-w-sm border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12] shadow-sm">
            {error}
          </div>
        ) : null}

        {/* Side panel */}
        <aside
          className={[
            "absolute bottom-0 right-0 top-0 z-10 flex w-full max-w-[300px] flex-col border-l border-line bg-white/95 shadow-lg backdrop-blur transition sm:max-w-[320px]",
            listOpen ? "translate-x-0" : "translate-x-full",
            "hidden md:flex",
          ].join(" ")}
        >
          <div className="border-b border-line px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Locaties
            </p>
            <p className="mt-0.5 font-display text-lg text-ink">
              {visible.length}{" "}
              <span className="text-sm font-sans text-muted">pins</span>
            </p>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto divide-y divide-line">
            {visible.length === 0 ? (
              <li className="px-4 py-8 text-sm text-muted">
                Geen pins in deze filter.
              </li>
            ) : (
              visible.map((p) => {
                const key = layerKey(p);
                const color = LAYER_COLOR[key] || LAYER_COLOR.overig;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => focusPin(p)}
                      className={[
                        "w-full px-4 py-3 text-left hover:bg-wash",
                        selectedId === p.id ? "bg-wash" : "",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={[
                            "inline-flex shrink-0 items-center justify-center text-[9px] font-bold text-white",
                            p.kind === "hq"
                              ? "h-6 w-6"
                              : p.kind === "adviseur" || p.kind === "monteur"
                                ? "h-6 w-6 rounded-full"
                                : "h-2.5 w-2.5 rounded-full",
                          ].join(" ")}
                          style={{ background: color }}
                        >
                          {p.kind === "hq"
                            ? "HQ"
                            : p.kind === "adviseur" || p.kind === "monteur"
                              ? initials(p.naam)
                              : null}
                        </span>
                        <span className="truncate text-sm font-medium text-ink">
                          {p.naam}
                        </span>
                      </div>
                      <p className="mt-0.5 pl-8 text-[11px] text-muted">
                        {p.kind === "hq"
                          ? "Daltonlaan 500 · Utrecht"
                          : p.kind === "adviseur"
                            ? p.start_adres || "Adviseur"
                            : p.kind === "monteur"
                              ? p.start_adres || p.functie || "Monteur"
                            : [p.functie, p.plaats].filter(Boolean).join(" · ") ||
                              p.status}
                        {p.kind === "kandidaat" && p.aangenomen
                          ? " · aangenomen"
                          : ""}
                      </p>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {selected ? (
            <div className="border-t border-line px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Geselecteerd
              </p>
              <p className="mt-0.5 text-sm font-semibold text-ink">
                {selected.naam}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {selected.kind === "hq" ||
                selected.kind === "adviseur" ||
                selected.kind === "monteur"
                  ? selected.start_adres || selected.functie
                  : [selected.functie, selected.plaats, selected.status]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
            </div>
          ) : null}
        </aside>

        {/* Mobile list sheet */}
        {listOpen ? (
          <div className="absolute inset-x-0 bottom-0 z-10 max-h-[42%] overflow-hidden border-t border-line bg-white/95 shadow-lg backdrop-blur md:hidden">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Locaties ({visible.length})
              </p>
              <button
                type="button"
                onClick={() => setListOpen(false)}
                className="text-xs font-semibold text-muted"
              >
                Dicht
              </button>
            </div>
            <ul className="max-h-[34vh] overflow-y-auto divide-y divide-line">
              {visible.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => focusPin(p)}
                    className="w-full px-3 py-2.5 text-left text-sm font-medium text-ink hover:bg-wash"
                  >
                    {p.naam}
                    <span className="mt-0.5 block text-[11px] font-normal text-muted">
                      {p.kind === "hq"
                        ? "HQ"
                        : p.kind === "adviseur"
                          ? "Adviseur"
                          : p.kind === "monteur"
                            ? "Monteur"
                            : p.functie || p.rol}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

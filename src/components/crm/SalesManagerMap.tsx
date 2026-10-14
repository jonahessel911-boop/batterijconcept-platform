"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";
import { formatTimeNl } from "@/lib/format";
import type { SalesManagerMapPin } from "@/lib/sales-manager";

function homeIcon(maps: typeof google.maps): google.maps.Symbol {
  return {
    path: "M12 3L4 9v12h5v-7h6v7h5V9L12 3z",
    fillColor: "#0D5C32",
    fillOpacity: 1,
    strokeColor: "#fff",
    strokeWeight: 1.5,
    scale: 1.35,
    anchor: new maps.Point(12, 22),
  };
}

function apptIcon(
  maps: typeof google.maps,
  active: boolean
): google.maps.Symbol {
  return {
    path: maps.SymbolPath.CIRCLE,
    fillColor: active ? "#C45A12" : "#1A4A6E",
    fillOpacity: 1,
    strokeColor: "#fff",
    strokeWeight: 2,
    scale: active ? 10 : 8,
  };
}

export function SalesManagerMap({
  pins,
  onSelect,
}: {
  pins: SalesManagerMapPin[];
  onSelect?: (pin: SalesManagerMapPin | null) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!elRef.current) return;
      setError(null);
      try {
        const maps = await loadGoogleMaps();
        if (cancelled || !elRef.current) return;

        if (!mapRef.current) {
          mapRef.current = new maps.Map(elRef.current, {
            center: { lat: 52.1, lng: 5.3 },
            zoom: 7,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
            clickableIcons: false,
          });
          infoRef.current = new maps.InfoWindow();
          mapRef.current.addListener("click", () => {
            infoRef.current?.close();
            onSelect?.(null);
          });
        }
        setReady(true);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Kaart kon niet laden"
          );
        }
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [onSelect]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    const maps = google.maps;

    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];
    infoRef.current?.close();

    if (pins.length === 0) return;

    const bounds = new maps.LatLngBounds();
    for (const pin of pins) {
      const pos = { lat: pin.lat, lng: pin.lng };
      bounds.extend(pos);
      const marker = new maps.Marker({
        map,
        position: pos,
        title: pin.label,
        icon: pin.kind === "home" ? homeIcon(maps) : apptIcon(maps, false),
        zIndex: pin.kind === "home" ? 20 : 10,
      });

      marker.addListener("mouseover", () => {
        if (pin.kind === "afspraak") {
          marker.setIcon(apptIcon(maps, true));
        }
        const time = pin.start_at ? formatTimeNl(pin.start_at) : "";
        const date = pin.start_at
          ? new Date(pin.start_at).toLocaleDateString("nl-NL", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })
          : "";
        const html =
          pin.kind === "home"
            ? `<div style="max-width:220px;font:12px/1.4 system-ui,sans-serif">
                <strong>🏠 Startadres</strong><br/>
                ${escapeHtml(pin.adres || pin.label)}
              </div>`
            : `<div style="max-width:240px;font:12px/1.4 system-ui,sans-serif">
                <strong>${escapeHtml(pin.lead_naam || pin.label)}</strong><br/>
                <span style="color:#666">${escapeHtml([date, time].filter(Boolean).join(" · "))}</span>
                ${pin.adres ? `<br/><span style="color:#666">${escapeHtml(pin.adres)}</span>` : ""}
                ${
                  pin.notitie
                    ? `<br/><em style="color:#333">${escapeHtml(pin.notitie)}</em>`
                    : ""
                }
              </div>`;
        infoRef.current?.setContent(html);
        infoRef.current?.open({ map, anchor: marker });
      });

      marker.addListener("mouseout", () => {
        if (pin.kind === "afspraak") {
          marker.setIcon(apptIcon(maps, false));
        }
      });

      marker.addListener("click", () => {
        onSelect?.(pin);
        if (pin.kind === "afspraak") {
          marker.setIcon(apptIcon(maps, true));
        }
      });

      markersRef.current.push(marker);
    }

    if (pins.length === 1) {
      map.setCenter({ lat: pins[0].lat, lng: pins[0].lng });
      map.setZoom(11);
    } else {
      map.fitBounds(bounds, 48);
    }
  }, [pins, ready, onSelect]);

  if (error) {
    return (
      <div className="flex h-[320px] items-center justify-center border border-line bg-wash px-4 text-center text-xs text-muted">
        {error}
      </div>
    );
  }

  if (pins.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center border border-line bg-wash px-4 text-center text-xs text-muted">
        Geen startadres of afspraaklocaties om te tonen.
      </div>
    );
  }

  return (
    <div
      ref={elRef}
      className="h-[320px] w-full border border-line bg-[#E8EEF2] sm:h-[380px]"
    />
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

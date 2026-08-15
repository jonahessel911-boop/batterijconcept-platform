"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";

/**
 * Google Street View + “Scan woning” gloed/uitlijn-animatie.
 */
export function MapZoom({
  query,
  lat,
  lng,
  confirmed,
  onScanned,
}: {
  query: string;
  lat?: number | null;
  lng?: number | null;
  confirmed?: boolean;
  onScanned?: () => void;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const svEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);

  const [phase, setPhase] = useState<
    "loading" | "scan" | "street" | "satellite3d" | "error"
  >("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hint, setHint] = useState("Woning lokaliseren…");
  const [houseScan, setHouseScan] = useState<
    "idle" | "scanning" | "done"
  >("idle");

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];

    async function run() {
      if (!mapEl.current || !svEl.current) return;
      setPhase("loading");
      setErrorMsg(null);
      setHint("Woning lokaliseren…");
      setHouseScan("idle");

      try {
        await loadGoogleMaps();
        if (cancelled || !mapEl.current || !svEl.current) return;

        let target = {
          lat: lat ?? 52.1326,
          lng: lng ?? 5.2913,
        };

        if (lat == null || lng == null) {
          const geocoder = new google.maps.Geocoder();
          const result = await geocoder.geocode({
            address: query,
            componentRestrictions: { country: "NL" },
            language: "nl",
            region: "NL",
          });
          const loc = result.results[0]?.geometry.location;
          if (loc) target = { lat: loc.lat(), lng: loc.lng() };
        }

        if (cancelled) return;

        if (!mapRef.current) {
          mapRef.current = new google.maps.Map(mapEl.current, {
            center: { lat: 52.2, lng: 5.3 },
            zoom: 6,
            mapTypeId: "roadmap",
            disableDefaultUI: true,
            gestureHandling: "none",
            clickableIcons: false,
          });
        }
        const map = mapRef.current;

        if (!markerRef.current) {
          markerRef.current = new google.maps.Marker({
            map,
            position: target,
            title: query,
          });
        } else {
          markerRef.current.setPosition(target);
          markerRef.current.setMap(map);
        }

        setPhase("scan");
        setHint("Inzoomen op adres…");
        map.setMapTypeId("roadmap");
        map.setOptions({ tilt: 0, heading: 0, gestureHandling: "none" });
        map.setCenter({ lat: 52.2, lng: 5.3 });
        map.setZoom(6);

        await wait(450, timers);
        if (cancelled) return;
        map.panTo(target);
        map.setZoom(12);
        setHint("Buurt laden…");

        await wait(700, timers);
        if (cancelled) return;
        map.setMapTypeId("hybrid");
        map.setZoom(17);
        setHint("Street View openen…");

        await wait(800, timers);
        if (cancelled) return;

        const svService = new google.maps.StreetViewService();
        let panoData: google.maps.StreetViewPanoramaData | null = null;

        try {
          const res = await svService.getPanorama({
            location: target,
            radius: 120,
            source: google.maps.StreetViewSource.OUTDOOR,
            preference: google.maps.StreetViewPreference.NEAREST,
          });
          panoData = res.data;
        } catch {
          try {
            const res = await svService.getPanorama({
              location: target,
              radius: 250,
            });
            panoData = res.data;
          } catch {
            panoData = null;
          }
        }

        if (cancelled) return;

        if (!panoData?.location?.latLng || !panoData.location.pano) {
          map.setZoom(19);
          map.setTilt(67.5);
          map.setHeading(40);
          map.setOptions({
            gestureHandling: "greedy",
            disableDefaultUI: false,
            zoomControl: true,
            rotateControl: true,
          });
          setPhase("satellite3d");
          setHint("Geen Street View — 3D-satelliet. Sleep om te draaien.");
          return;
        }

        const panoLoc = panoData.location.latLng;
        const heading = google.maps.geometry.spherical.computeHeading(
          panoLoc,
          new google.maps.LatLng(target.lat, target.lng)
        );

        if (!panoRef.current) {
          panoRef.current = new google.maps.StreetViewPanorama(svEl.current, {
            pano: panoData.location.pano,
            position: panoLoc,
            pov: { heading, pitch: 0 },
            zoom: 0.4,
            addressControl: true,
            linksControl: true,
            panControl: true,
            enableCloseButton: false,
            fullscreenControl: true,
            clickToGo: true,
            scrollwheel: true,
            showRoadLabels: true,
          });
        } else {
          panoRef.current.setPano(panoData.location.pano);
          panoRef.current.setPosition(panoLoc);
          panoRef.current.setPov({ heading, pitch: 0 });
          panoRef.current.setVisible(true);
        }

        map.setStreetView(panoRef.current);
        setPhase("street");
        setHint("Sleep om rond te kijken · klik pijlen om te lopen");
      } catch (e) {
        if (!cancelled) {
          setPhase("error");
          setErrorMsg(
            e instanceof Error ? e.message : "Google Maps laden mislukt"
          );
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [query, lat, lng]);

  function startHouseScan() {
    if (houseScan === "scanning") return;
    setHouseScan("scanning");
    setHint("Woning scannen… uitlijnen");
    window.setTimeout(() => {
      setHouseScan("done");
      setHint("Woning uitgelijnd — scan klaar");
      onScanned?.();
    }, 4200);
  }

  const showStreet = phase === "street";
  const showMap = phase !== "street";
  const canScan =
    (phase === "street" || phase === "satellite3d") && houseScan !== "scanning";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-white shadow-[0_12px_40px_rgba(13,92,50,0.08)]">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-wash px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green text-[11px] font-bold text-white">
            ✓
          </span>
          <p className="text-xs font-semibold text-ink sm:text-sm">
            Woning checken
          </p>
        </div>
        <p className="max-w-[55%] truncate text-right text-[11px] text-muted sm:text-xs">
          {hint}
        </p>
      </div>

      <div className="relative aspect-[16/11] w-full sm:aspect-[16/10]">
        <div
          ref={mapEl}
          className={[
            "absolute inset-0 h-full w-full",
            showMap ? "z-[1]" : "z-0 opacity-0 pointer-events-none",
          ].join(" ")}
        />
        <div
          ref={svEl}
          className={[
            "absolute inset-0 h-full w-full",
            showStreet ? "z-[2]" : "z-0 opacity-0 pointer-events-none",
          ].join(" ")}
        />

        {(phase === "loading" || phase === "scan") && (
          <div className="pointer-events-none absolute inset-0 z-[3] flex flex-col items-center justify-center gap-3 bg-white/50">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-green/25 border-t-green" />
            <p className="text-sm font-medium text-green-dark">{hint}</p>
          </div>
        )}

        {phase === "error" && (
          <div className="absolute inset-0 z-[3] flex items-center justify-center bg-white px-4 text-center text-sm text-red-600">
            {errorMsg || "Kaart kon niet geladen worden"}
          </div>
        )}

        {/* Scan woning overlay */}
        {(houseScan === "scanning" || houseScan === "done") && (
          <div className="pointer-events-none absolute inset-0 z-[5]">
            <div className="absolute inset-0 bg-[#0d5c32]/15" />
            {/* Horizontal scan beam */}
            {houseScan === "scanning" && (
              <div className="woning-scan-beam absolute inset-x-0 h-24" />
            )}
            {/* House outline glow */}
            <svg
              viewBox="0 0 400 280"
              className="absolute inset-0 h-full w-full"
              aria-hidden
            >
              <defs>
                <filter id="woningGlow" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="4" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {/* Soft fill */}
              <path
                d="M200 48 L310 120 L310 230 L90 230 L90 120 Z"
                fill="rgba(26,138,62,0.12)"
                className={
                  houseScan === "done"
                    ? "opacity-100"
                    : "woning-scan-fill opacity-0"
                }
              />
              {/* Outline draws */}
              <path
                d="M200 48 L310 120 L310 230 L90 230 L90 120 Z"
                fill="none"
                stroke="#3dd68c"
                strokeWidth="3.5"
                strokeLinejoin="round"
                filter="url(#woningGlow)"
                className="woning-scan-outline"
                pathLength={1}
              />
              {/* Roof ridge accent */}
              <path
                d="M200 48 L200 230"
                fill="none"
                stroke="#9dffc4"
                strokeWidth="1.5"
                strokeDasharray="6 8"
                opacity="0.7"
                className="woning-scan-outline"
                pathLength={1}
                style={{ animationDelay: "0.35s" }}
              />
              {/* Window markers */}
              <rect
                x="120"
                y="145"
                width="36"
                height="28"
                rx="3"
                fill="none"
                stroke="#9dffc4"
                strokeWidth="2"
                className="woning-scan-window"
              />
              <rect
                x="244"
                y="145"
                width="36"
                height="28"
                rx="3"
                fill="none"
                stroke="#9dffc4"
                strokeWidth="2"
                className="woning-scan-window"
                style={{ animationDelay: "0.5s" }}
              />
              <rect
                x="178"
                y="175"
                width="44"
                height="55"
                rx="3"
                fill="none"
                stroke="#f37021"
                strokeWidth="2.5"
                className="woning-scan-window"
                style={{ animationDelay: "0.75s" }}
              />
            </svg>

            {houseScan === "scanning" && (
              <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-green px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-lg">
                Woning uitlijnen…
              </div>
            )}
            {houseScan === "done" && (
              <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-green px-3 py-1.5 text-[11px] font-bold text-white shadow-lg">
                ✓ Woning gescand
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scan button row */}
      {canScan && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-wash px-4 py-3">
          <p className="text-xs text-muted">
            {houseScan === "done"
              ? "Scan klaar — bevestig hieronder de woning."
              : "Klik om de woning visueel uit te lijnen."}
          </p>
          <button
            type="button"
            onClick={startHouseScan}
            disabled={houseScan === "scanning"}
            className={[
              "rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition",
              houseScan === "done"
                ? "bg-green-dark hover:bg-green"
                : "bg-green hover:bg-green-dark",
              "disabled:opacity-60",
            ].join(" ")}
          >
            {houseScan === "done" ? "Opnieuw scannen" : "Scan woning"}
          </button>
        </div>
      )}

      {confirmed && (
        <div className="absolute bottom-14 left-3 right-3 z-[6] rounded-xl bg-green px-3 py-2.5 text-center text-xs font-semibold text-white shadow-lg sm:bottom-16">
          Woning bevestigd — check geslaagd
        </div>
      )}
    </div>
  );
}

function wait(ms: number, timers: number[]): Promise<void> {
  return new Promise((resolve) => {
    timers.push(window.setTimeout(resolve, ms));
  });
}

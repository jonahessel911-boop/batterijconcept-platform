"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getGoogleMapsApiKey, loadGoogleMaps } from "@/lib/google-maps";
import { adresRegel } from "@/lib/format";

type Adres = {
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
};

type Props = {
  adres: Adres | null | undefined;
  className?: string;
  /** Hoogte van de kaartcontainer. */
  mapClassName?: string;
};

type Maps3DLib = {
  Map3DElement: new (opts: {
    center: { lat: number; lng: number; altitude?: number };
    range?: number;
    tilt?: number;
    heading?: number;
    mode?: string;
  }) => HTMLElement & {
    center: { lat: number; lng: number; altitude?: number };
    range: number;
    tilt: number;
    heading: number;
  };
  Marker3DElement?: new (opts: {
    position: { lat: number; lng: number; altitude?: number };
    altitudeMode?: string;
    extruded?: boolean;
  }) => HTMLElement;
};

/**
 * Interactieve 3D-luchtview (Maps 3D / satelliet met tilt) van het adres.
 */
export function AdresSatellietKaart({
  adres,
  className,
  mapClassName,
}: Props) {
  const key = getGoogleMapsApiKey();
  const label = adres ? adresRegel(adres) : "";
  const query = useMemo(() => {
    if (!adres || !label || label === "—") return null;
    return `${label}, Nederland`;
  }, [adres, label]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [modeLabel, setModeLabel] = useState("3D-luchtview");

  useEffect(() => {
    if (!query || !key || !containerRef.current) {
      if (!query) setStatus("ready");
      return;
    }

    let cancelled = false;
    const el = containerRef.current;
    el.replaceChildren();

    void (async () => {
      setStatus("loading");
      setErrorMsg(null);
      try {
        const maps = await loadGoogleMaps();
        if (cancelled) return;

        const geocoder = new maps.Geocoder();
        const geo = await geocoder.geocode({
          address: query,
          region: "nl",
          language: "nl",
        });
        if (cancelled) return;

        const result = geo.results[0];
        if (!result?.geometry?.location) {
          throw new Error("Adres niet gevonden op de kaart");
        }
        const loc = result.geometry.location;
        const lat = loc.lat();
        const lng = loc.lng();

        // 1) Probeer Photorealistic 3D (echte 3D vanaf boven, draaien/kantelen).
        try {
          const maps3d = (await google.maps.importLibrary(
            "maps3d"
          )) as Maps3DLib;
          if (cancelled || !maps3d?.Map3DElement) {
            throw new Error("maps3d niet beschikbaar");
          }

          const map3d = new maps3d.Map3DElement({
            center: { lat, lng, altitude: 80 },
            range: 280,
            tilt: 55,
            heading: 20,
            mode: "HYBRID",
          });
          map3d.style.width = "100%";
          map3d.style.height = "100%";
          map3d.style.display = "block";
          map3d.style.border = "0";

          if (maps3d.Marker3DElement) {
            const marker = new maps3d.Marker3DElement({
              position: { lat, lng, altitude: 0 },
              altitudeMode: "CLAMP_TO_GROUND",
              extruded: true,
            });
            map3d.append(marker);
          }

          el.append(map3d);
          if (!cancelled) {
            setModeLabel("3D-luchtview · sleep om te draaien");
            setStatus("ready");
          }
          return;
        } catch {
          // Fallback hieronder
        }

        // 2) Fallback: satelliet + 45° tilt (3D-gebouwen waar beschikbaar).
        const map = new maps.Map(el, {
          center: { lat, lng },
          zoom: 20,
          mapTypeId: "hybrid",
          tilt: 45,
          heading: 20,
          disableDefaultUI: false,
          mapTypeControl: true,
          mapTypeControlOptions: {
            mapTypeIds: ["hybrid", "satellite", "roadmap"],
          },
          rotateControl: true,
          streetViewControl: true,
          fullscreenControl: true,
          zoomControl: true,
          gestureHandling: "greedy",
        });

        new maps.Marker({
          map,
          position: { lat, lng },
          title: label,
        });

        // Forceer tilt na idle (sommige tiles starten flat).
        maps.event.addListenerOnce(map, "idle", () => {
          map.setTilt(45);
          map.setHeading(20);
        });

        if (!cancelled) {
          setModeLabel("Satelliet 3D · kantel/draai met knoppen");
          setStatus("ready");
        }
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(
            e instanceof Error ? e.message : "Kaart laden mislukt"
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      el.replaceChildren();
    };
  }, [query, key, label]);

  if (!query) {
    return (
      <p className="text-sm text-muted">Geen adres beschikbaar voor de kaart.</p>
    );
  }

  if (!key) {
    const encoded = encodeURIComponent(query);
    return (
      <div className="space-y-2 rounded-lg border border-line bg-wash/50 px-3 py-3 text-sm">
        <p className="font-medium text-ink">{label}</p>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encoded}`}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-green-dark hover:underline"
        >
          Open in Google Maps (3D)
        </a>
        <p className="text-xs text-muted">
          Zet NEXT_PUBLIC_GOOGLE_MAPS_API_KEY voor ingebouwde 3D-luchtview.
        </p>
      </div>
    );
  }

  const encoded = encodeURIComponent(query);

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">{label}</p>
          <p className="text-[11px] text-muted">{modeLabel}</p>
        </div>
        <a
          href={`https://www.google.com/maps/@?api=1&map_action=map&center=${encoded}&zoom=20&basemap=satellite`}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-semibold text-green-dark hover:underline"
        >
          Open in Google Maps
        </a>
      </div>

      <div
        data-map-frame
        className="relative overflow-hidden rounded-lg border border-line bg-wash"
      >
        <div
          ref={containerRef}
          className={
            mapClassName || "h-[min(70vh,560px)] w-full min-h-[320px]"
          }
        />
        {status === "loading" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-wash/80 text-sm text-muted">
            3D-kaart laden…
          </div>
        ) : null}
        {status === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-wash px-4 text-center text-sm">
            <p className="font-medium text-ink">
              {errorMsg || "Kaart niet beschikbaar"}
            </p>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encoded}`}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-green-dark hover:underline"
            >
              Open adres in Google Maps
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

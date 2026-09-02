import { errMessage } from "@/lib/errors";

export type TravelLeg = {
  durationSec: number;
  durationText: string;
  distanceM: number | null;
  distanceText: string | null;
  provider: "google" | "osrm" | "estimate";
};

type LatLng = { lat: number; lon: number };

function mapsKey(): string | undefined {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    undefined
  );
}

function formatDurationNl(sec: number): string {
  if (sec < 60) return `${sec} sec.`;
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins} min.`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} u ${m} min.` : `${h} u`;
}

function formatDistanceNl(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km.toLocaleString("nl-NL", {
    maximumFractionDigits: km >= 10 ? 0 : 1,
  })} km`;
}

function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ruwe rijtijd: hemelsbreed × 1.35 (wegen) @ ~48 km/u. */
function estimateDriveSec(a: LatLng, b: LatLng): {
  durationSec: number;
  distanceM: number;
} {
  const straight = haversineM(a, b);
  const roadM = straight * 1.35;
  const durationSec = Math.max(60, Math.round((roadM / 1000 / 48) * 3600));
  return { durationSec, distanceM: Math.round(roadM) };
}

export async function geocodeAddress(
  address: string
): Promise<LatLng | null> {
  const key = mapsKey();
  if (!key) return null;
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", address);
    url.searchParams.set("key", key);
    url.searchParams.set("language", "nl");
    url.searchParams.set("region", "nl");
    url.searchParams.set("components", "country:NL");
    const res = await fetch(url.toString(), {
      next: { revalidate: 86400 },
    });
    const data = (await res.json()) as {
      status?: string;
      results?: { geometry: { location: { lat: number; lng: number } } }[];
    };
    const loc = data.results?.[0]?.geometry?.location;
    if (data.status !== "OK" || !loc) return null;
    return { lat: loc.lat, lon: loc.lng };
  } catch {
    return null;
  }
}

async function googleDistanceMatrix(
  origins: string[],
  destinations: string[]
): Promise<{
  durationMap: Map<string, number>;
  distanceMap: Map<string, number>;
} | null> {
  const key = mapsKey();
  if (!key) return null;

  const durationMap = new Map<string, number>();
  const distanceMap = new Map<string, number>();
  const chunkSize = 10;

  try {
    for (let oi = 0; oi < origins.length; oi += chunkSize) {
      const oChunk = origins.slice(oi, oi + chunkSize);
      for (let di = 0; di < destinations.length; di += chunkSize) {
        const dChunk = destinations.slice(di, di + chunkSize);
        const url = new URL(
          "https://maps.googleapis.com/maps/api/distancematrix/json"
        );
        url.searchParams.set("origins", oChunk.join("|"));
        url.searchParams.set("destinations", dChunk.join("|"));
        url.searchParams.set("mode", "driving");
        url.searchParams.set("language", "nl");
        url.searchParams.set("region", "nl");
        url.searchParams.set("key", key);

        const res = await fetch(url.toString(), { cache: "no-store" });
        const data = (await res.json()) as {
          status?: string;
          rows?: {
            elements?: {
              status?: string;
              duration?: { value?: number };
              distance?: { value?: number };
            }[];
          }[];
        };

        if (data.status !== "OK") return null;

        for (let r = 0; r < oChunk.length; r++) {
          const row = data.rows?.[r]?.elements || [];
          for (let c = 0; c < dChunk.length; c++) {
            const el = row[c];
            const mapKey = `${oChunk[r]}|||${dChunk[c]}`;
            if (el?.status === "OK" && el.duration?.value != null) {
              durationMap.set(mapKey, el.duration.value);
            }
            if (el?.status === "OK" && el.distance?.value != null) {
              distanceMap.set(mapKey, el.distance.value);
            }
          }
        }
      }
    }
    return { durationMap, distanceMap };
  } catch {
    return null;
  }
}

async function osrmTableMatrix(
  points: LatLng[]
): Promise<{
  durations: number[][];
  distances: number[][];
} | null> {
  if (points.length < 2) return null;
  try {
    const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
    const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration,distance`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "batterijconcept-crm/1.0" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: string;
      durations?: (number | null)[][];
      distances?: (number | null)[][];
    };
    if (data.code !== "Ok" || !data.durations) return null;
    const durations = data.durations.map((row) =>
      row.map((v) => (v == null || Number.isNaN(v) ? -1 : Math.round(v)))
    );
    const distances = (data.distances || []).map((row) =>
      row.map((v) => (v == null || Number.isNaN(v) ? -1 : Math.round(v)))
    );
    return { durations, distances };
  } catch {
    return null;
  }
}

/**
 * Bouw duration- + distance-map tussen adressen.
 * 1) Google Distance Matrix (als key dat mag)
 * 2) Geocoding (werkt bij jullie) + OSRM rijtijden
 * 3) Geocoding + hemelsbreed-schatting
 */
export async function buildDurationMap(
  addresses: string[]
): Promise<{
  durationMap: Map<string, number>;
  distanceMap: Map<string, number>;
  provider: "google" | "osrm" | "estimate";
}> {
  const unique = [...new Set(addresses.map((a) => a.trim()).filter(Boolean))];
  const durationMap = new Map<string, number>();
  const distanceMap = new Map<string, number>();
  if (unique.length < 2) {
    return { durationMap, distanceMap, provider: "estimate" };
  }

  const google = await googleDistanceMatrix(unique, unique);
  if (google && google.durationMap.size > 0) {
    return {
      durationMap: google.durationMap,
      distanceMap: google.distanceMap,
      provider: "google",
    };
  }

  const coords: (LatLng | null)[] = await Promise.all(
    unique.map((a) => geocodeAddress(a))
  );
  const validIdx: number[] = [];
  const validPts: LatLng[] = [];
  for (let i = 0; i < unique.length; i++) {
    if (coords[i]) {
      validIdx.push(i);
      validPts.push(coords[i]!);
    }
  }

  if (validPts.length >= 2) {
    const osrm = await osrmTableMatrix(validPts);
    if (osrm) {
      for (let i = 0; i < validIdx.length; i++) {
        for (let j = 0; j < validIdx.length; j++) {
          const sec = osrm.durations[i]?.[j];
          const mapKey = `${unique[validIdx[i]]}|||${unique[validIdx[j]]}`;
          if (sec != null && sec >= 0) durationMap.set(mapKey, sec);
          const dist = osrm.distances[i]?.[j];
          if (dist != null && dist >= 0) distanceMap.set(mapKey, dist);
        }
      }
      if (durationMap.size > 0) {
        return { durationMap, distanceMap, provider: "osrm" };
      }
    }

    for (let i = 0; i < validIdx.length; i++) {
      for (let j = 0; j < validIdx.length; j++) {
        const mapKey = `${unique[validIdx[i]]}|||${unique[validIdx[j]]}`;
        if (i === j) {
          durationMap.set(mapKey, 0);
          distanceMap.set(mapKey, 0);
          continue;
        }
        const est = estimateDriveSec(validPts[i], validPts[j]);
        durationMap.set(mapKey, est.durationSec);
        distanceMap.set(mapKey, est.distanceM);
      }
    }
    return { durationMap, distanceMap, provider: "estimate" };
  }

  return { durationMap, distanceMap, provider: "estimate" };
}

/** Eén leg from → to, met fallbacks. */
export async function travelTimeBetween(
  from: string,
  to: string
): Promise<TravelLeg> {
  if (from.trim() === to.trim()) {
    return {
      durationSec: 0,
      durationText: "0 min.",
      distanceM: 0,
      distanceText: "0 m",
      provider: "estimate",
    };
  }

  const { durationMap, distanceMap, provider } = await buildDurationMap([
    from,
    to,
  ]);
  const sec = durationMap.get(`${from}|||${to}`);
  if (sec == null) {
    throw new Error("Geen reistijd gevonden");
  }

  const distanceM = distanceMap.get(`${from}|||${to}`) ?? null;

  return {
    durationSec: sec,
    durationText: formatDurationNl(sec),
    distanceM,
    distanceText: distanceM != null ? formatDistanceNl(distanceM) : null,
    provider,
  };
}

export function travelErrorMessage(e: unknown): string {
  return errMessage(e, "Reistijd ophalen mislukt");
}

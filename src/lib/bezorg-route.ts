import { BEZORG_HQ, BEZORG_MAX_STOPS_PER_DAG } from "@/lib/recruitment-rollen";
import { geocodeAddress } from "@/lib/travel-time";

export type BezorgStopInput = {
  project_id: string;
  adres: string;
  lat: number | null;
  lng: number | null;
};

export type OptimizedStop = BezorgStopInput & {
  volgorde: number;
  lat: number;
  lng: number;
};

async function resolvePoint(
  stop: BezorgStopInput
): Promise<{ lat: number; lng: number } | null> {
  if (
    stop.lat != null &&
    stop.lng != null &&
    Number.isFinite(stop.lat) &&
    Number.isFinite(stop.lng)
  ) {
    return { lat: stop.lat, lng: stop.lng };
  }
  const t = stop.adres.trim();
  if (!t) return null;
  const point = await geocodeAddress(
    /nederland|netherlands/i.test(t) ? t : `${t}, Nederland`
  );
  if (!point) return null;
  const lat = Number(point.lat);
  const lng = Number(point.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest-neighbour vanaf HQ (fallback). */
function nearestNeighborOrder(
  hq: { lat: number; lng: number },
  points: Array<BezorgStopInput & { lat: number; lng: number }>
): Array<BezorgStopInput & { lat: number; lng: number }> {
  const remaining = [...points];
  const ordered: Array<BezorgStopInput & { lat: number; lng: number }> = [];
  let cur = hq;
  while (remaining.length) {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(cur, remaining[i]);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    const next = remaining.splice(bestI, 1)[0];
    ordered.push(next);
    cur = next;
  }
  return ordered;
}

/**
 * OSRM trip API: optimale volgorde met vaste start (HQ), geen roundtrip.
 * Fallback: nearest-neighbour.
 */
export async function optimizeBezorgStops(
  stops: BezorgStopInput[]
): Promise<OptimizedStop[]> {
  if (stops.length === 0) return [];
  if (stops.length > BEZORG_MAX_STOPS_PER_DAG) {
    throw new Error(`Maximaal ${BEZORG_MAX_STOPS_PER_DAG} stops per dag`);
  }

  const resolved: Array<BezorgStopInput & { lat: number; lng: number }> = [];
  for (const s of stops) {
    const pt = await resolvePoint(s);
    if (!pt) {
      throw new Error(`Geen coördinaten voor: ${s.adres || s.project_id}`);
    }
    resolved.push({ ...s, lat: pt.lat, lng: pt.lng });
  }

  const hq = { lat: BEZORG_HQ.lat, lng: BEZORG_HQ.lng };

  try {
    const coords = [
      `${hq.lng},${hq.lat}`,
      ...resolved.map((p) => `${p.lng},${p.lat}`),
    ].join(";");
    // source=first → HQ vast; roundtrip=false → eindigt bij laatste stop
    const url = `https://router.project-osrm.org/trip/v1/driving/${coords}?source=first&roundtrip=false&geometries=geojson`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "batterijconcept-crm/1.0" },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        code?: string;
        waypoints?: Array<{ waypoint_index?: number; trips_index?: number }>;
      };
      // waypoints staan in input-volgorde; waypoint_index = positie in de trip
      if (
        data.code === "Ok" &&
        Array.isArray(data.waypoints) &&
        data.waypoints.length === resolved.length + 1
      ) {
        const ordered = resolved
          .map((stop, i) => ({
            stop,
            order:
              typeof data.waypoints![i + 1]?.waypoint_index === "number"
                ? data.waypoints![i + 1].waypoint_index!
                : i + 1,
          }))
          .sort((a, b) => a.order - b.order)
          .map((x) => x.stop);
        return ordered.map((s, i) => ({ ...s, volgorde: i + 1 }));
      }
    }
  } catch {
    /* fallback */
  }

  return nearestNeighborOrder(hq, resolved).map((s, i) => ({
    ...s,
    volgorde: i + 1,
  }));
}

export function mapsNavUrl(lat: number, lng: number, label?: string): string {
  const q = label
    ? encodeURIComponent(label)
    : `${lat},${lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
}

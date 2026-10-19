/** Eenvoudige convex hull (Andrew's monotone chain) op lat/lng. */

export type GeoPt = { lat: number; lon: number };

function cross(o: GeoPt, a: GeoPt, b: GeoPt): number {
  return (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
}

/**
 * Convex hull van punten. Bij &lt; 3 unieke punten: die punten terug.
 * Output is clockwise/counter-clockwise ring (gesloten door Google Maps zelf).
 */
export function convexHull(points: GeoPt[]): GeoPt[] {
  const uniq: GeoPt[] = [];
  const seen = new Set<string>();
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const key = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(p);
  }
  if (uniq.length <= 2) return uniq;

  const sorted = [...uniq].sort(
    (a, b) => a.lon - b.lon || a.lat - b.lat
  );

  const lower: GeoPt[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: GeoPt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Kleine buffer rond één punt (approx. graden) voor zichtbaar vlak. */
export function pointAsTinyPolygon(
  p: GeoPt,
  deltaDeg = 0.04
): GeoPt[] {
  return [
    { lat: p.lat - deltaDeg, lon: p.lon - deltaDeg },
    { lat: p.lat - deltaDeg, lon: p.lon + deltaDeg },
    { lat: p.lat + deltaDeg, lon: p.lon + deltaDeg },
    { lat: p.lat + deltaDeg, lon: p.lon - deltaDeg },
  ];
}

/** Twee punten → smalle “capsule”-achtige vierhoek. */
export function segmentAsPolygon(a: GeoPt, b: GeoPt, widthDeg = 0.03): GeoPt[] {
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * widthDeg;
  const ny = (dx / len) * widthDeg;
  return [
    { lat: a.lat + ny, lon: a.lon + nx },
    { lat: b.lat + ny, lon: b.lon + nx },
    { lat: b.lat - ny, lon: b.lon - nx },
    { lat: a.lat - ny, lon: a.lon - nx },
  ];
}

export function regionPolygonFromPoints(points: GeoPt[]): GeoPt[] | null {
  if (points.length === 0) return null;
  if (points.length === 1) return pointAsTinyPolygon(points[0]);
  if (points.length === 2) return segmentAsPolygon(points[0], points[1]);
  const hull = convexHull(points);
  return hull.length >= 3 ? hull : null;
}

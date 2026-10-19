import { formatLeadAdres } from "@/lib/fonio";
import { isUsableStartAdres } from "@/lib/start-adres";
import { isPlanbareAdviseur } from "@/lib/rollen";
import {
  geocodeAddress,
  estimateDriveSec,
  ONE_HOUR_DRIVE_RADIUS_M,
  ONE_HOUR_DRIVE_SEC,
  type LatLng,
} from "@/lib/travel-time";

export { ONE_HOUR_DRIVE_RADIUS_M, ONE_HOUR_DRIVE_SEC };

export type DekkingAdviseur = {
  id: string;
  naam: string;
  /** Initialen voor op de kaart */
  initialen: string;
  startAdres: string;
  lat: number;
  lon: number;
  /** Leads deze maand toegewezen aan deze regio (dichtstbij binnen 1u) */
  leadsInStraal: number;
  /** Totaal leads met bruikbaar adres deze maand (zelfde set als dekking) */
  leadsTotaalMaand: number;
};

export type DekkingLeadPunt = {
  id: string;
  lat: number;
  lon: number;
  /** Dichtstbijzijnde adviseur binnen 1u, anders null */
  adviseurId: string | null;
};

export type AdviseurDekkingResult = {
  jaar: number;
  maand: number;
  label: string;
  radiusM: number;
  maxDriveSec: number;
  adviseurs: DekkingAdviseur[];
  leadsTotaal: number;
  leadsGeocodeerd: number;
  leadsCovered: number;
  leadsUncovered: number;
  /** Alle geocodeerde leads (max 800) voor Leadflow-kaart */
  leadPoints: DekkingLeadPunt[];
};

export function adviseurInitialen(naam: string): string {
  const parts = naam
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((p) => !/^(van|de|der|den|het|te|ten|'t)$/i.test(p));
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (
    (parts[0][0] || "") + (parts[parts.length - 1][0] || "")
  ).toUpperCase();
}

type AdviseurRow = {
  id: string;
  naam: string;
  email?: string | null;
  rol?: string | null;
  actief?: boolean | null;
  start_adres?: string | null;
};

type LeadRow = {
  id: string;
  created_at: string;
  postcode?: string | null;
  plaats?: string | null;
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
};

function leadAdresKey(lead: LeadRow): string | null {
  const full = formatLeadAdres(lead).trim();
  if (full) return full;
  const pc = (lead.postcode || "").trim();
  const plaats = (lead.plaats || "").trim();
  if (pc || plaats) return [pc, plaats].filter(Boolean).join(" ");
  return null;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export async function buildAdviseurDekking(opts: {
  adviseurs: AdviseurRow[];
  leads: LeadRow[];
  jaar: number;
  maand: number;
}): Promise<AdviseurDekkingResult> {
  const label = new Date(opts.jaar, opts.maand - 1, 1).toLocaleDateString(
    "nl-NL",
    { month: "long", year: "numeric" }
  );

  const planbaar = opts.adviseurs.filter(
    (a) =>
      isPlanbareAdviseur(a) &&
      isUsableStartAdres(a.start_adres || "")
  );

  const geocodedAdviseurs: {
    id: string;
    naam: string;
    startAdres: string;
    point: LatLng;
  }[] = [];

  for (const a of planbaar) {
    const startAdres = (a.start_adres || "").trim();
    const point = await geocodeAddress(startAdres);
    if (!point) continue;
    geocodedAdviseurs.push({
      id: a.id,
      naam: a.naam,
      startAdres,
      point,
    });
  }

  const adresKeys = new Map<string, string[]>();
  for (const lead of opts.leads) {
    const key = leadAdresKey(lead);
    if (!key) continue;
    const list = adresKeys.get(key) || [];
    list.push(lead.id);
    adresKeys.set(key, list);
  }

  const uniqueAdressen = [...adresKeys.keys()];
  const geocodeResults = await mapPool(uniqueAdressen, 8, async (adres) => {
    const point = await geocodeAddress(adres);
    return { adres, point };
  });

  const pointByLeadId = new Map<string, LatLng>();
  for (const { adres, point } of geocodeResults) {
    if (!point) continue;
    for (const id of adresKeys.get(adres) || []) {
      pointByLeadId.set(id, point);
    }
  }

  const rawLeadPoints = [...pointByLeadId.entries()].map(([id, point]) => ({
    id,
    ...point,
  }));
  const leadsGeocodeerd = rawLeadPoints.length;
  const leadsTotaal = opts.leads.length;

  const counts = new Map<string, number>();
  for (const a of geocodedAdviseurs) counts.set(a.id, 0);

  const leadPoints: DekkingLeadPunt[] = [];
  let leadsCovered = 0;

  for (const lp of rawLeadPoints) {
    let bestId: string | null = null;
    let bestSec = Infinity;
    for (const a of geocodedAdviseurs) {
      const { durationSec } = estimateDriveSec(a.point, {
        lat: lp.lat,
        lon: lp.lon,
      });
      if (durationSec > ONE_HOUR_DRIVE_SEC) continue;
      if (durationSec < bestSec) {
        bestSec = durationSec;
        bestId = a.id;
      }
    }
    if (bestId) {
      leadsCovered += 1;
      counts.set(bestId, (counts.get(bestId) || 0) + 1);
    }
    if (leadPoints.length < 800) {
      leadPoints.push({
        id: lp.id,
        lat: lp.lat,
        lon: lp.lon,
        adviseurId: bestId,
      });
    }
  }

  const adviseurs: DekkingAdviseur[] = geocodedAdviseurs.map((a) => ({
    id: a.id,
    naam: a.naam,
    initialen: adviseurInitialen(a.naam),
    startAdres: a.startAdres,
    lat: a.point.lat,
    lon: a.point.lon,
    leadsInStraal: counts.get(a.id) || 0,
    leadsTotaalMaand: leadsGeocodeerd,
  }));

  return {
    jaar: opts.jaar,
    maand: opts.maand,
    label,
    radiusM: ONE_HOUR_DRIVE_RADIUS_M,
    maxDriveSec: ONE_HOUR_DRIVE_SEC,
    adviseurs: adviseurs.sort(
      (a, b) =>
        b.leadsInStraal - a.leadsInStraal || a.naam.localeCompare(b.naam, "nl")
    ),
    leadsTotaal,
    leadsGeocodeerd,
    leadsCovered,
    leadsUncovered: Math.max(0, leadsGeocodeerd - leadsCovered),
    leadPoints,
  };
}

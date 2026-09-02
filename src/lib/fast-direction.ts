import { formatInTimeZone } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export type FastDirectionStop = {
  start_at: string;
  end_at: string;
  address: string;
  label?: string;
};

export type FastDirectionSlot = {
  start_at: string;
  end_at: string;
};

export type FastDirectionSuggestion = {
  start_at: string;
  end_at: string;
  scoreSec: number;
  feasible: boolean;
  reason: string;
  dayKey: string;
  /** Eerste afspraak die dag (vanaf startadres adviseur). */
  fromDepot: boolean;
  fromLabel: string | null;
  toLabel: string | null;
  fromDurationSec: number | null;
  toDurationSec: number | null;
  fromDurationText: string | null;
  toDurationText: string | null;
  fromDistanceText: string | null;
  toDistanceText: string | null;
  mapsUrl: string | null;
};

function dayKeyOf(iso: string): string {
  return formatInTimeZone(iso, AMSTERDAM_TZ, "yyyy-MM-dd");
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

function gapSec(fromEndIso: string, toStartIso: string): number {
  return Math.max(
    0,
    (new Date(toStartIso).getTime() - new Date(fromEndIso).getTime()) / 1000
  );
}

export function googleMapsMultiStopUrl(addresses: string[]): string | null {
  const clean = addresses.map((a) => a.trim()).filter((a) => a && a !== "—");
  if (clean.length === 0) return null;
  if (clean.length === 1) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(clean[0])}&travelmode=driving`;
  }
  const origin = encodeURIComponent(clean[0]);
  const destination = encodeURIComponent(clean[clean.length - 1]);
  const waypoints =
    clean.length > 2
      ? clean
          .slice(1, -1)
          .map((a) => encodeURIComponent(a))
          .join("%7C")
      : "";
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  return url;
}

/**
 * Score alle vrije slots: per dag het beste passend slot (rijtijd),
 * daarna dagen op volgorde (vroeger eerst). Max `limit` opties.
 */
export function pickTopFastDirectionSlots(
  opts: {
    targetAddress: string;
    freeSlots: FastDirectionSlot[];
    stops: FastDirectionStop[];
    depotAddress?: string | null;
    depotLabel?: string | null;
    durationSecBetween: (from: string, to: string) => number | null;
    distanceMBetween?: (from: string, to: string) => number | null;
  },
  limit = 3
): FastDirectionSuggestion[] {
  const target = opts.targetAddress.trim();
  if (!target || target === "—" || opts.freeSlots.length === 0) return [];

  const depot = (opts.depotAddress || "").trim();
  const hasDepot = Boolean(depot && depot !== "—");
  const depotName = opts.depotLabel?.trim() || "adviseur";
  const depotLabel = `Startlocatie (${depotName})`;

  const stopsByDay = new Map<string, FastDirectionStop[]>();
  for (const s of opts.stops) {
    if (!s.address?.trim() || s.address === "—") continue;
    const key = dayKeyOf(s.start_at);
    const list = stopsByDay.get(key) || [];
    list.push(s);
    stopsByDay.set(key, list);
  }
  for (const list of stopsByDay.values()) {
    list.sort(
      (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
    );
  }

  type Scored = FastDirectionSuggestion & {
    dayFitKey: number;
  };
  const scored: Scored[] = [];

  for (const slot of opts.freeSlots) {
    const day = dayKeyOf(slot.start_at);
    const dayStops = stopsByDay.get(day) || [];
    const slotStart = new Date(slot.start_at).getTime();
    const slotEnd = new Date(slot.end_at).getTime();

    const prevStop =
      [...dayStops]
        .filter((s) => new Date(s.end_at).getTime() <= slotStart)
        .sort(
          (a, b) =>
            new Date(b.end_at).getTime() - new Date(a.end_at).getTime()
        )[0] || null;
    const next =
      dayStops.find((s) => new Date(s.start_at).getTime() >= slotEnd) || null;

    const fromDepot = !prevStop && hasDepot;
    const prev = prevStop
      ? prevStop
      : fromDepot
        ? {
            start_at: slot.start_at,
            end_at: slot.start_at,
            address: depot,
            label: depotLabel,
          }
        : null;

    let fromDurationSec: number | null = null;
    let toDurationSec: number | null = null;
    let fromDistanceM: number | null = null;
    let toDistanceM: number | null = null;
    let feasible = true;
    let scoreSec = 0;
    let insertBonus = 0;

    if (prev) {
      fromDurationSec = opts.durationSecBetween(prev.address, target);
      fromDistanceM = opts.distanceMBetween?.(prev.address, target) ?? null;
      if (fromDurationSec == null) {
        scoreSec += 3 * 60 * 60;
        feasible = false;
      } else {
        scoreSec += fromDurationSec;
        if (!fromDepot) {
          const gap = gapSec(prev.end_at, slot.start_at);
          if (fromDurationSec > gap + 60) feasible = false;
        }
      }
    }

    if (next) {
      toDurationSec = opts.durationSecBetween(target, next.address);
      toDistanceM = opts.distanceMBetween?.(target, next.address) ?? null;
      if (toDurationSec == null) {
        scoreSec += 3 * 60 * 60;
        feasible = false;
      } else {
        scoreSec += toDurationSec;
        const gap = gapSec(slot.end_at, next.start_at);
        if (toDurationSec > gap + 60) feasible = false;
      }
    }

    if (prevStop && next) {
      insertBonus = -15 * 60;
    } else if (prevStop || next) {
      insertBonus = -5 * 60;
    }

    if (!prev && !next) {
      scoreSec = 40 * 60;
      feasible = true;
    }

    const mapsParts = [
      prev?.address,
      target,
      next?.address,
    ].filter(Boolean) as string[];

    const fromDistPart =
      fromDistanceM != null ? ` · ${formatDistanceNl(fromDistanceM)}` : "";
    const toDistPart =
      toDistanceM != null ? ` · ${formatDistanceNl(toDistanceM)}` : "";

    let reason: string;
    if (fromDepot && !next) {
      reason =
        fromDurationSec != null
          ? `Eerste afspraak die dag · ${formatDurationNl(fromDurationSec)}${fromDistPart} vanaf startlocatie.`
          : `Eerste afspraak die dag vanaf startlocatie.`;
    } else if (fromDepot && next) {
      reason =
        fromDurationSec != null
          ? `Eerste die dag: ${formatDurationNl(fromDurationSec)}${fromDistPart} vanaf startlocatie, daarna ${formatDurationNl(toDurationSec || 0)} naar ${next.label || "volgende"}.`
          : `Eerste die dag vanaf startlocatie, vóór ${next.label || "volgende"}.`;
    } else if (!prev && !next) {
      reason =
        "Geen andere fysieke afspraken die dag — vroegste vrije slot. (Geen startadres ingesteld.)";
    } else if (prev && next) {
      reason = feasible
        ? `Past tussen ${prev.label || "vorige"} en ${next.label || "volgende"} (samen ${formatDurationNl(scoreSec)} rijden).`
        : `Tussen ${prev.label || "vorige"} en ${next.label || "volgende"}, maar krap op reistijd.`;
    } else if (prev) {
      reason = feasible
        ? `Na ${prev.label || "vorige afspraak"} · ${formatDurationNl(fromDurationSec || 0)}${fromDistPart} rijden.`
        : `Na ${prev.label || "vorige afspraak"}, maar reistijd past niet in de pauze.`;
    } else {
      // Geen startadres, wel latere afspraak die dag
      reason = feasible
        ? `Voor ${next!.label || "volgende afspraak"} · ${formatDurationNl(toDurationSec || 0)}${toDistPart} rijden. (Geen startadres — stel in onder Instellingen.)`
        : `Voor ${next!.label || "volgende afspraak"}, maar krap op reistijd.`;
    }

    const fitScore = scoreSec + insertBonus;

    scored.push({
      start_at: slot.start_at,
      end_at: slot.end_at,
      scoreSec,
      feasible,
      reason,
      dayKey: day,
      fromDepot,
      fromLabel: prev?.label || null,
      toLabel: next?.label || null,
      fromDurationSec,
      toDurationSec,
      fromDurationText:
        fromDurationSec != null ? formatDurationNl(fromDurationSec) : null,
      toDurationText:
        toDurationSec != null ? formatDurationNl(toDurationSec) : null,
      fromDistanceText:
        fromDistanceM != null ? formatDistanceNl(fromDistanceM) : null,
      toDistanceText:
        toDistanceM != null ? formatDistanceNl(toDistanceM) : null,
      mapsUrl: googleMapsMultiStopUrl(mapsParts),
      dayFitKey:
        (feasible ? 0 : 1_000_000_000) +
        fitScore +
        new Date(slot.start_at).getTime() / 1e13,
    });
  }

  const bestByDay = new Map<string, Scored>();
  for (const s of scored) {
    const cur = bestByDay.get(s.dayKey);
    if (!cur || s.dayFitKey < cur.dayFitKey) bestByDay.set(s.dayKey, s);
  }

  const ranked = [...bestByDay.values()].sort((a, b) => {
    if (a.dayKey !== b.dayKey) return a.dayKey.localeCompare(b.dayKey);
    return a.dayFitKey - b.dayFitKey;
  });

  return ranked.slice(0, limit).map(({ dayFitKey: _d, ...rest }) => rest);
}

/** Eén beste optie (eerste van top-lijst). */
export function pickBestFastDirectionSlot(opts: {
  targetAddress: string;
  freeSlots: FastDirectionSlot[];
  stops: FastDirectionStop[];
  depotAddress?: string | null;
  depotLabel?: string | null;
  durationSecBetween: (from: string, to: string) => number | null;
}): FastDirectionSuggestion | null {
  return pickTopFastDirectionSlots(opts, 1)[0] || null;
}

/** Unieke adressen voor Distance Matrix (max elementen beperken). */
export function uniqueAddresses(
  target: string,
  stops: FastDirectionStop[],
  depotAddress?: string | null,
  limit = 10
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const a = raw.trim();
    if (!a || a === "—" || seen.has(a)) return;
    seen.add(a);
    out.push(a);
  };
  push(target);
  if (depotAddress) push(depotAddress);
  for (const s of stops) push(s.address);
  return out.slice(0, limit);
}

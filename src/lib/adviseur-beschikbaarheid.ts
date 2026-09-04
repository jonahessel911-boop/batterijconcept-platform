import type { SupabaseClient } from "@supabase/supabase-js";
import { getISOWeek, getISOWeekYear } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import { ADVISEUR_SLOT_HOURS } from "@/lib/slots";

export type WeekKey = { jaar: number; week: number };

export type SlotHour = (typeof ADVISEUR_SLOT_HOURS)[number];

export function weekKeyFromDate(d: Date): WeekKey {
  const zoned = toZonedTime(d, AMSTERDAM_TZ);
  return {
    jaar: getISOWeekYear(zoned),
    week: getISOWeek(zoned),
  };
}

export function weekKeyString(jaar: number, week: number): string {
  return `${jaar}-W${String(week).padStart(2, "0")}`;
}

export function isSlotHour(hour: number): hour is SlotHour {
  return (ADVISEUR_SLOT_HOURS as readonly number[]).includes(hour);
}

/** Key voor één geblokkeerd blok: adviseur + dag + uur */
export function afblokKey(
  adviseurId: string,
  dag: string,
  slotHour: number
): string {
  return `${adviseurId}:${dag}:${slotHour}`;
}

export function dayKeyAmsterdam(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

/** Nearest vaste slot-hour (10/13/16/19) voor een starttijd. */
export function nearestSlotHour(startAt: string | Date): SlotHour {
  const t = Number(formatInTimeZone(new Date(startAt), AMSTERDAM_TZ, "H"));
  const m = Number(formatInTimeZone(new Date(startAt), AMSTERDAM_TZ, "m"));
  const local = t + m / 60;
  let best: SlotHour = ADVISEUR_SLOT_HOURS[0];
  let bestDist = Infinity;
  for (const h of ADVISEUR_SLOT_HOURS) {
    const d = Math.abs(h - local);
    if (d < bestDist) {
      bestDist = d;
      best = h;
    }
  }
  return best;
}

function isMissingAfblokTable(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    msg.includes("adviseur_afblokkingen") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

/**
 * Haalt weken op waarop de adviseur expliciet NIET beschikbaar is.
 * Ontbrekende rijen = beschikbaar (default).
 */
export async function loadUnavailableWeekKeys(
  sb: SupabaseClient,
  adviseurId: string,
  jaren: number[]
): Promise<Set<string>> {
  const unavailable = new Set<string>();
  if (!adviseurId || jaren.length === 0) return unavailable;

  const { data, error } = await sb
    .from("adviseur_beschikbaarheid")
    .select("jaar, week, beschikbaar")
    .eq("adviseur_id", adviseurId)
    .in("jaar", jaren)
    .eq("beschikbaar", false);

  if (error) {
    // Tabel/migratie ontbreekt → behandel als “alles beschikbaar”
    if (
      error.code === "42703" ||
      error.code === "42P01" ||
      error.message?.includes("adviseur_beschikbaarheid") ||
      error.message?.includes("schema cache")
    ) {
      return unavailable;
    }
    throw error;
  }

  for (const row of data || []) {
    unavailable.add(weekKeyString(row.jaar, row.week));
  }
  return unavailable;
}

/**
 * Geblokkeerde tijdsblokken voor één of meer adviseurs in een datumbereik.
 * Key = `${adviseurId}:${yyyy-MM-dd}:${hour}`
 */
export async function loadAfblokkingen(
  sb: SupabaseClient,
  opts: {
    adviseurIds: string[];
    van: string;
    tot: string;
  }
): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (!opts.adviseurIds.length) return blocked;

  const { data, error } = await sb
    .from("adviseur_afblokkingen")
    .select("adviseur_id, dag, slot_hour")
    .in("adviseur_id", opts.adviseurIds)
    .gte("dag", opts.van)
    .lte("dag", opts.tot);

  if (error) {
    if (isMissingAfblokTable(error)) return blocked;
    throw error;
  }

  for (const row of data || []) {
    blocked.add(afblokKey(row.adviseur_id, row.dag, row.slot_hour));
  }
  return blocked;
}

export async function isSlotAfgeblokt(
  sb: SupabaseClient,
  adviseurId: string,
  startAt: Date
): Promise<boolean> {
  const dag = dayKeyAmsterdam(startAt);
  const hour = nearestSlotHour(startAt);
  const { data, error } = await sb
    .from("adviseur_afblokkingen")
    .select("id")
    .eq("adviseur_id", adviseurId)
    .eq("dag", dag)
    .eq("slot_hour", hour)
    .maybeSingle();

  if (error) {
    if (isMissingAfblokTable(error)) return false;
    throw error;
  }
  return Boolean(data);
}

/** Filter slots die als tijdsblok zijn afgeblokt. */
export function filterSlotsByAfblokkingen<T extends { start_at: string }>(
  slots: T[],
  adviseurId: string,
  blocked: Set<string>
): T[] {
  if (blocked.size === 0) return slots;
  return slots.filter((s) => {
    const dag = dayKeyAmsterdam(s.start_at);
    const hour = nearestSlotHour(s.start_at);
    return !blocked.has(afblokKey(adviseurId, dag, hour));
  });
}

/** Filter slots/blocks waarvan de start in een niet-beschikbare week valt. */
export function filterSlotsByBeschikbaarheid<T extends { start_at: string }>(
  slots: T[],
  unavailable: Set<string>
): T[] {
  if (unavailable.size === 0) return slots;
  return slots.filter((s) => {
    const k = weekKeyFromDate(new Date(s.start_at));
    return !unavailable.has(weekKeyString(k.jaar, k.week));
  });
}

export function isDateUnavailable(
  date: Date,
  unavailable: Set<string>
): boolean {
  const k = weekKeyFromDate(date);
  return unavailable.has(weekKeyString(k.jaar, k.week));
}

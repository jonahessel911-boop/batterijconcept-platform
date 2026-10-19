import type { SupabaseClient } from "@supabase/supabase-js";
import { getISOWeek, getISOWeekYear } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import { ADVISEUR_SLOT_HOURS } from "@/lib/slots";
import { skipsMaandagOchtendmeeting } from "@/lib/start-adres";

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

function amsterdamWeekday(dateOrDayKey: Date | string): number {
  if (
    typeof dateOrDayKey === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateOrDayKey)
  ) {
    const [y, m, d] = dateOrDayKey.split("-").map(Number);
    // Wall-clock weekdag op die kalenderdag (geen TZ-shift)
    return new Date(y, m - 1, d).getDay();
  }
  const zoned = toZonedTime(
    typeof dateOrDayKey === "string" ? new Date(dateOrDayKey) : dateOrDayKey,
    AMSTERDAM_TZ
  );
  return zoned.getDay();
}

/** Zondag (Amsterdam) is standaard altijd geblokkeerd voor adviseur-slots. */
export function isZondagAmsterdam(dateOrDayKey: Date | string): boolean {
  return amsterdamWeekday(dateOrDayKey) === 0;
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

/**
 * Maandag 10:00 (Amsterdam) — weekmeeting op kantoor.
 * Altijd standaard geblokkeerd, net als zondag.
 * @param hour — verplicht bij dayKey `yyyy-MM-dd`; anders uit starttijd gehaald.
 */
export function isMaandagTienAmsterdam(
  dateOrDayKey: Date | string,
  hour?: number
): boolean {
  if (amsterdamWeekday(dateOrDayKey) !== 1) return false;
  if (
    typeof dateOrDayKey === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateOrDayKey)
  ) {
    return hour === 10;
  }
  return nearestSlotHour(dateOrDayKey) === 10;
}

/**
 * Hard geblokkeerd (niet te openen): maandag 10:00 weekmeeting.
 * Uitzondering: adviseurs die de ochtendmeeting overslaan (bijv. Marcel).
 * Zondag is standaard dicht maar mag via vrijgave open.
 */
export function isHardGeblokkeerdSlot(
  dateOrDayKey: Date | string,
  hour?: number,
  adviseurId?: string | null
): boolean {
  if (!isMaandagTienAmsterdam(dateOrDayKey, hour)) return false;
  if (skipsMaandagOchtendmeeting(adviseurId)) return false;
  return true;
}

/**
 * Standaard-geblokkeerd vóór vrijgave-check.
 * Zondag + maandag 10:00. Gebruik `isSlotGeblokkeerd` met vrijgaven voor effectieve status.
 */
export function isStandaardGeblokkeerdSlot(
  dateOrDayKey: Date | string,
  hour?: number,
  adviseurId?: string | null
): boolean {
  if (isZondagAmsterdam(dateOrDayKey)) return true;
  return isHardGeblokkeerdSlot(dateOrDayKey, hour, adviseurId);
}

/** Mag dit standaard-slot via afblok-modus worden geopend? (alleen zondag). */
export function magStandaardSlotOntblokken(
  dateOrDayKey: Date | string,
  hour?: number,
  adviseurId?: string | null
): boolean {
  if (isHardGeblokkeerdSlot(dateOrDayKey, hour, adviseurId)) return false;
  return isZondagAmsterdam(dateOrDayKey);
}

export function standaardBlokkadeLabel(
  dateOrDayKey: Date | string,
  hour?: number,
  adviseurId?: string | null
): string | null {
  if (isHardGeblokkeerdSlot(dateOrDayKey, hour, adviseurId)) {
    return "Maandag 10:00 is standaard geblokkeerd (weekmeeting)";
  }
  if (isZondagAmsterdam(dateOrDayKey)) {
    return "Zondag is standaard geblokkeerd";
  }
  return null;
}

/**
 * Effectieve blokkade: hard (ma 10) → altijd dicht;
 * zondag → dicht tenzij vrijgegeven;
 * overige → alleen via afblokkingen-set.
 */
export function isSlotGeblokkeerd(
  adviseurId: string,
  dayKey: string,
  hour: number,
  afblokkingen: Set<string>,
  vrijgaven: Set<string> = new Set()
): boolean {
  if (isHardGeblokkeerdSlot(dayKey, hour, adviseurId)) return true;
  const key = afblokKey(adviseurId, dayKey, hour);
  if (isZondagAmsterdam(dayKey)) {
    return !vrijgaven.has(key);
  }
  return afblokkingen.has(key);
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

function isMissingVrijgaveTable(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    msg.includes("adviseur_slot_vrijgaven") ||
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

/**
 * Zondag-vrijgaven (open slots) voor adviseurs in datumbereik.
 * Key = zelfde als afblokKey.
 */
export async function loadSlotVrijgaven(
  sb: SupabaseClient,
  opts: {
    adviseurIds: string[];
    van: string;
    tot: string;
  }
): Promise<Set<string>> {
  const open = new Set<string>();
  if (!opts.adviseurIds.length) return open;

  const { data, error } = await sb
    .from("adviseur_slot_vrijgaven")
    .select("adviseur_id, dag, slot_hour")
    .in("adviseur_id", opts.adviseurIds)
    .gte("dag", opts.van)
    .lte("dag", opts.tot);

  if (error) {
    if (isMissingVrijgaveTable(error)) return open;
    throw error;
  }

  for (const row of data || []) {
    open.add(afblokKey(row.adviseur_id, row.dag, row.slot_hour));
  }
  return open;
}

export async function isSlotAfgeblokt(
  sb: SupabaseClient,
  adviseurId: string,
  startAt: Date
): Promise<boolean> {
  if (isHardGeblokkeerdSlot(startAt, undefined, adviseurId)) return true;

  const dag = dayKeyAmsterdam(startAt);
  const hour = nearestSlotHour(startAt);

  if (isZondagAmsterdam(startAt)) {
    const { data, error } = await sb
      .from("adviseur_slot_vrijgaven")
      .select("id")
      .eq("adviseur_id", adviseurId)
      .eq("dag", dag)
      .eq("slot_hour", hour)
      .maybeSingle();
    if (error) {
      if (isMissingVrijgaveTable(error)) return true; // standaard dicht
      throw error;
    }
    return !data; // vrijgave = open
  }

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

/**
 * Filter slots die als tijdsblok zijn afgeblokt
 * (ma 10 hard, zondag tenzij vrijgegeven, overige via afblokkingen).
 */
export function filterSlotsByAfblokkingen<T extends { start_at: string }>(
  slots: T[],
  adviseurId: string,
  blocked: Set<string>,
  vrijgaven: Set<string> = new Set()
): T[] {
  return slots.filter((s) => {
    const dag = dayKeyAmsterdam(s.start_at);
    const hour = nearestSlotHour(s.start_at);
    return !isSlotGeblokkeerd(adviseurId, dag, hour, blocked, vrijgaven);
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

/** yyyy-MM-dd + dagen (kalender, lokale wall-clock). */
export function addCalendarDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Weekdagen (ma–vr) van `fromYmd` t/m `toYmd` (inclusief), als yyyy-MM-dd.
 */
export function weekdaysInclusive(fromYmd: string, toYmd: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) {
    return [];
  }
  if (fromYmd > toYmd) return [];
  const out: string[] = [];
  let cur = fromYmd;
  while (cur <= toYmd) {
    const [y, m, d] = cur.split("-").map(Number);
    const wd = new Date(y, m - 1, d).getDay(); // 0=zo … 6=za
    if (wd >= 1 && wd <= 5) out.push(cur);
    cur = addCalendarDaysYmd(cur, 1);
    if (out.length > 400) break;
  }
  return out;
}

/** Alle kalenderdagen (incl. za/zo) van `fromYmd` t/m `toYmd`. */
export function calendarDaysInclusive(fromYmd: string, toYmd: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) {
    return [];
  }
  if (fromYmd > toYmd) return [];
  const out: string[] = [];
  let cur = fromYmd;
  while (cur <= toYmd) {
    out.push(cur);
    cur = addCalendarDaysYmd(cur, 1);
    if (out.length > 400) break;
  }
  return out;
}

/**
 * Geen slots vóór startdatum (Amsterdam-dag).
 * Hard filter — ook zaterdag/zondag, ongeacht afblokkingen.
 */
export function filterSlotsByStartdatum<T extends { start_at: string }>(
  slots: T[],
  startdatumYmd: string | null | undefined
): T[] {
  const sd = (startdatumYmd || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sd)) return slots;
  return slots.filter((s) => dayKeyAmsterdam(s.start_at) >= sd);
}

/** True als startAt op een Amsterdam-dag vóór startdatum valt. */
export function isBeforeStartdatum(
  startAt: Date | string,
  startdatumYmd: string | null | undefined
): boolean {
  const sd = (startdatumYmd || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sd)) return false;
  return dayKeyAmsterdam(startAt) < sd;
}

/**
 * Blokkeer alle vaste slots (10/13/16/19) op élke dag vóór startdatum
 * (incl. za/zo). Van vandaag (Amsterdam) t/m dag vóór startdatum.
 */
export async function blockAgendaUntilStartdatum(
  sb: SupabaseClient,
  adviseurId: string,
  startdatumYmd: string
): Promise<{ blockedDays: number; blockedSlots: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startdatumYmd)) {
    return { blockedDays: 0, blockedSlots: 0 };
  }
  const today = dayKeyAmsterdam(new Date());
  const lastDay = addCalendarDaysYmd(startdatumYmd, -1);
  if (lastDay < today) {
    return { blockedDays: 0, blockedSlots: 0 };
  }
  const days = calendarDaysInclusive(today, lastDay);
  const rows: { adviseur_id: string; dag: string; slot_hour: number }[] = [];
  for (const dag of days) {
    for (const hour of ADVISEUR_SLOT_HOURS) {
      rows.push({ adviseur_id: adviseurId, dag, slot_hour: hour });
    }
  }
  if (!rows.length) return { blockedDays: 0, blockedSlots: 0 };

  const { error } = await sb
    .from("adviseur_afblokkingen")
    .upsert(rows, { onConflict: "adviseur_id,dag,slot_hour" });
  if (error) throw error;
  return { blockedDays: days.length, blockedSlots: rows.length };
}

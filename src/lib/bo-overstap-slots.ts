/**
 * Vrije 30-min overstap-slots uit Taken-agenda (bo_agenda) van backoffice.
 * Ma–vr 09:00–17:00 Amsterdam, lunch 12:00–12:30 geblokkeerd.
 */

import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AMSTERDAM_TZ } from "@/lib/format";
import { normalizeRol } from "@/lib/rollen";

export const OVERSTAP_SLOT_MINUTES = 30;
const LUNCH_START_MIN = 12 * 60; // 12:00
const LUNCH_END_MIN = 12 * 60 + 30; // 12:30
const DAY_START_MIN = 9 * 60;
const DAY_END_MIN = 17 * 60;

export type BoOverstapSlot = {
  start_at: string;
  end_at: string;
  adviseur_id: string;
  adviseur_naam: string;
};

type Busy = { start: number; end: number };

function overlaps(a: Busy, b: Busy): boolean {
  return a.start < b.end && b.start < a.end;
}

function overlapsLunch(startMin: number, endMin: number): boolean {
  return startMin < LUNCH_END_MIN && endMin > LUNCH_START_MIN;
}

function candidateStartsForDay(ymd: string): Date[] {
  // ymd = yyyy-MM-dd in Amsterdam
  const out: Date[] = [];
  for (let m = DAY_START_MIN; m + OVERSTAP_SLOT_MINUTES <= DAY_END_MIN; m += 30) {
    if (overlapsLunch(m, m + OVERSTAP_SLOT_MINUTES)) continue;
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    const local = `${ymd}T${hh}:${mm}:00`;
    const d = fromZonedTime(local, AMSTERDAM_TZ);
    if (!Number.isNaN(d.getTime())) out.push(d);
  }
  return out;
}

function isWeekdayAmsterdam(d: Date): boolean {
  const dow = formatInTimeZone(d, AMSTERDAM_TZ, "i"); // 1=Mon … 7=Sun
  const n = Number(dow);
  return n >= 1 && n <= 5;
}

/**
 * Volgende `limit` vrije overstap-slots over alle actieve BO/admin-agenda's.
 */
export async function findBoOverstapSlots(
  sb: SupabaseClient,
  opts?: {
    limit?: number;
    daysAhead?: number;
    /** Slots die al in de uitnodiging staan — overslaan */
    excludeStarts?: string[];
  }
): Promise<BoOverstapSlot[]> {
  const limit = opts?.limit ?? 10;
  const daysAhead = opts?.daysAhead ?? 21;
  const exclude = new Set(
    (opts?.excludeStarts || [])
      .map((s) => {
        const t = new Date(s).getTime();
        return Number.isFinite(t) ? t : null;
      })
      .filter((t): t is number => t != null)
  );

  const { data: adviseursRaw } = await sb
    .from("adviseurs")
    .select("id, naam, email, actief, rol")
    .eq("actief", true)
    .order("naam");

  const bos = ((adviseursRaw || []) as {
    id: string;
    naam: string;
    email?: string | null;
    actief?: boolean | null;
    rol?: string | null;
  }[]).filter((a) => {
    const rol = normalizeRol(a.rol);
    return rol === "backoffice" || rol === "admin";
  });

  if (bos.length === 0) return [];

  const now = Date.now();
  const rangeStart = new Date(now + 60 * 60 * 1000); // min. +1u
  const rangeEnd = addDays(new Date(), daysAhead);

  const ids = bos.map((b) => b.id);
  const { data: agendaRows } = await sb
    .from("bo_agenda")
    .select("adviseur_id, start_at, end_at, status, soort")
    .in("adviseur_id", ids)
    .eq("status", "todo")
    .gte("start_at", new Date(now - 24 * 60 * 60 * 1000).toISOString())
    .lte("start_at", rangeEnd.toISOString())
    .limit(2000);

  // Ook bestaande overstaps in dezelfde periode blokkeren per “pool”
  // (ze zitten nog niet altijd in bo_agenda)
  const { data: overstaps } = await sb
    .from("projecten")
    .select("overstap_afspraak_at")
    .not("overstap_afspraak_at", "is", null)
    .gte("overstap_afspraak_at", rangeStart.toISOString())
    .lte("overstap_afspraak_at", rangeEnd.toISOString())
    .limit(500);

  const busyByAdv = new Map<string, Busy[]>();
  for (const id of ids) busyByAdv.set(id, []);

  for (const row of agendaRows || []) {
    const aid = row.adviseur_id as string;
    const start = new Date(row.start_at as string).getTime();
    if (!Number.isFinite(start)) continue;
    let end = row.end_at
      ? new Date(row.end_at as string).getTime()
      : start + OVERSTAP_SLOT_MINUTES * 60_000;
    if (!Number.isFinite(end) || end <= start) {
      end = start + OVERSTAP_SLOT_MINUTES * 60_000;
    }
    busyByAdv.get(aid)?.push({ start, end });
  }

  // Globale busy: bestaande overstap-afspraken (elke BO “bezet” op dat moment pool-breed)
  const globalBusy: Busy[] = [];
  for (const p of overstaps || []) {
    const at = p.overstap_afspraak_at as string | null;
    if (!at) continue;
    const start = new Date(at).getTime();
    if (!Number.isFinite(start)) continue;
    globalBusy.push({
      start,
      end: start + OVERSTAP_SLOT_MINUTES * 60_000,
    });
  }

  const found: BoOverstapSlot[] = [];
  const usedStarts = new Set<number>();

  for (let dayOffset = 0; dayOffset < daysAhead && found.length < limit; dayOffset++) {
    const day = addDays(new Date(), dayOffset);
    if (!isWeekdayAmsterdam(day)) continue;
    const ymd = formatInTimeZone(day, AMSTERDAM_TZ, "yyyy-MM-dd");

    for (const startDate of candidateStartsForDay(ymd)) {
      if (found.length >= limit) break;
      const startMs = startDate.getTime();
      if (startMs < rangeStart.getTime()) continue;
      if (exclude.has(startMs) || usedStarts.has(startMs)) continue;

      const endMs = startMs + OVERSTAP_SLOT_MINUTES * 60_000;
      const cand: Busy = { start: startMs, end: endMs };

      if (globalBusy.some((b) => overlaps(cand, b))) continue;

      // Eerste BO die vrij is op dit slot
      let owner: (typeof bos)[number] | null = null;
      for (const bo of bos) {
        const busy = busyByAdv.get(bo.id) || [];
        if (busy.some((b) => overlaps(cand, b))) continue;
        owner = bo;
        break;
      }
      if (!owner) continue;

      usedStarts.add(startMs);
      found.push({
        start_at: new Date(startMs).toISOString(),
        end_at: new Date(endMs).toISOString(),
        adviseur_id: owner.id,
        adviseur_naam: owner.naam,
      });
    }
  }

  return found;
}

/** Check of een specifiek slot nog vrij is voor deze BO. */
export async function isBoOverstapSlotFree(
  sb: SupabaseClient,
  adviseurId: string,
  startAtIso: string
): Promise<boolean> {
  const start = new Date(startAtIso).getTime();
  if (!Number.isFinite(start)) return false;
  const end = start + OVERSTAP_SLOT_MINUTES * 60_000;

  // Lunch / openingstijden (Amsterdam)
  const hhmm = formatInTimeZone(new Date(start), AMSTERDAM_TZ, "HH:mm");
  const [h, m] = hhmm.split(":").map(Number);
  const startMin = h * 60 + m;
  const endMin = startMin + OVERSTAP_SLOT_MINUTES;
  if (startMin < DAY_START_MIN || endMin > DAY_END_MIN) return false;
  if (overlapsLunch(startMin, endMin)) return false;
  if (!isWeekdayAmsterdam(new Date(start))) return false;

  const { data: rows } = await sb
    .from("bo_agenda")
    .select("start_at, end_at")
    .eq("adviseur_id", adviseurId)
    .eq("status", "todo")
    .lt("start_at", new Date(end).toISOString())
    .gte(
      "start_at",
      new Date(start - 8 * 60 * 60 * 1000).toISOString()
    )
    .limit(200);

  const cand: Busy = { start, end };
  for (const row of rows || []) {
    const s = new Date(row.start_at as string).getTime();
    const e = row.end_at
      ? new Date(row.end_at as string).getTime()
      : s + OVERSTAP_SLOT_MINUTES * 60_000;
    if (overlaps(cand, { start: s, end: e })) return false;
  }

  const { data: overstaps } = await sb
    .from("projecten")
    .select("overstap_afspraak_at")
    .gte(
      "overstap_afspraak_at",
      new Date(start - OVERSTAP_SLOT_MINUTES * 60_000).toISOString()
    )
    .lt("overstap_afspraak_at", new Date(end).toISOString())
    .limit(5);
  if ((overstaps || []).length > 0) return false;

  return true;
}

/**
 * Weekmeeting: weekdoelen + aandachtspunten per adviseur (ISO-week).
 */

import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AMSTERDAM_TZ } from "@/lib/format";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import { publicProfielfotoUrl } from "@/lib/adviseur-profielfoto";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";
import {
  formatSchouwWeekLabel,
  schouwWeekEerder,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
  type SchouwWeek,
} from "@/lib/schouw-week";

export type WeekmeetingEntry = {
  target: number;
  aandachtspunten: string;
};

/** { "2026-W42": { "<adviseurId>": { target, aandachtspunten } } } */
export type WeekmeetingStore = Record<
  string,
  Record<string, WeekmeetingEntry>
>;

export type WeekmeetingRow = {
  adviseur_id: string;
  naam: string;
  /** Publieke URL van profielfoto (of null) */
  profielfoto_url: string | null;
  /** Fysieke afspraken in deze ISO-week (niet-geannuleerd) */
  afspraken_week: number;
  /** Sales target week (invoer) */
  target: number | null;
  /** Aandachtspunten voor deze week (stickers) */
  aandachtspunten: string;
  /** Aandachtspunten uit vorige weekmeeting (meenemen) */
  aandachtspunten_vorige: string;
  /** Vorige week: target gehaald? null = geen target */
  gehaald: boolean | null;
};

export type WeekmeetingPayload = {
  weekKey: string;
  weekLabel: string;
  weekNumber: number;
  jaar: number;
  rangeLabel: string;
  prevWeekKey: string;
  nextWeekKey: string;
  rows: WeekmeetingRow[];
};

function emptyEntry(): WeekmeetingEntry {
  return { target: 0, aandachtspunten: "" };
}

export function parseWeekmeetingStore(raw: unknown): WeekmeetingStore {
  if (!raw || typeof raw !== "object") return {};
  const out: WeekmeetingStore = {};
  for (const [wk, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-W\d{1,2}$/i.test(wk) || !v || typeof v !== "object") continue;
    const month: Record<string, WeekmeetingEntry> = {};
    for (const [aid, entry] of Object.entries(v as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const target =
        typeof e.target === "number"
          ? e.target
          : Number(e.target);
      month[aid] = {
        target: Number.isFinite(target) && target >= 0 ? Math.round(target) : 0,
        aandachtspunten:
          typeof e.aandachtspunten === "string" ? e.aandachtspunten : "",
      };
    }
    if (Object.keys(month).length > 0) out[wk] = month;
  }
  return out;
}

export async function loadWeekmeetingStore(
  sb: SupabaseClient
): Promise<{ id: string | null; store: WeekmeetingStore }> {
  const { data, error } = await sb
    .from("dashboard_instellingen")
    .select("id, weekmeeting_doelen")
    .eq("actief", true)
    .limit(1)
    .maybeSingle();

  if (
    error &&
    (error.code === "42703" ||
      error.message?.includes("weekmeeting_doelen"))
  ) {
    return { id: null, store: {} };
  }
  if (error) throw error;
  return {
    id: (data?.id as string) || null,
    store: parseWeekmeetingStore(data?.weekmeeting_doelen),
  };
}

async function saveWeekmeetingStore(
  sb: SupabaseClient,
  store: WeekmeetingStore,
  existingId: string | null
): Promise<void> {
  if (existingId) {
    const { error } = await sb
      .from("dashboard_instellingen")
      .update({ weekmeeting_doelen: store })
      .eq("id", existingId);
    if (
      error &&
      (error.code === "42703" ||
        error.message?.includes("weekmeeting_doelen"))
    ) {
      throw new Error(
        "Kolom weekmeeting_doelen ontbreekt — voer migrate-weekmeeting.sql uit"
      );
    }
    if (error) throw error;
    return;
  }
  const { error } = await sb.from("dashboard_instellingen").insert({
    weekmeeting_doelen: store,
    actief: true,
  });
  if (
    error &&
    (error.code === "42703" ||
      error.message?.includes("weekmeeting_doelen"))
  ) {
    throw new Error(
      "Kolom weekmeeting_doelen ontbreekt — voer migrate-weekmeeting.sql uit"
    );
  }
  if (error) throw error;
}

export function weekKeyFromDate(d = new Date()): string {
  const { jaar, week } = schouwWeekFromDate(d);
  return schouwWeekValue(jaar, week);
}

export function parseWeekKey(weekKey: string): SchouwWeek | null {
  const m = /^(\d{4})-W(\d{1,2})$/i.exec(weekKey.trim());
  if (!m) return null;
  return { jaar: Number(m[1]), week: Number(m[2]) };
}

function weekNeighbors(weekKey: string): {
  prev: string;
  next: string;
  info: SchouwWeek;
} {
  const info = parseWeekKey(weekKey) || schouwWeekFromDate(new Date());
  const prev = schouwWeekEerder(info.jaar, info.week);
  // Volgende week = +7d vanaf maandag
  const mondayIso = schouwWeekToMondayIso(info.jaar, info.week);
  const nextDate = addDays(new Date(mondayIso), 7);
  const nextInfo = schouwWeekFromDate(nextDate);
  return {
    info,
    prev: schouwWeekValue(prev.jaar, prev.week),
    next: schouwWeekValue(nextInfo.jaar, nextInfo.week),
  };
}

function weekBoundsIso(jaar: number, week: number): {
  startIso: string;
  endIso: string;
} {
  const mondayNoon = new Date(schouwWeekToMondayIso(jaar, week));
  const ymd = formatInTimeZone(mondayNoon, AMSTERDAM_TZ, "yyyy-MM-dd");
  const [y, m, d] = ymd.split("-").map(Number);
  const startIso = fromZonedTime(
    new Date(y, m - 1, d, 0, 0, 0, 0),
    AMSTERDAM_TZ
  ).toISOString();
  const endIso = fromZonedTime(
    new Date(y, m - 1, d + 7, 0, 0, 0, 0),
    AMSTERDAM_TZ
  ).toISOString();
  return { startIso, endIso };
}

export async function buildWeekmeeting(
  sb: SupabaseClient,
  weekKey: string
): Promise<WeekmeetingPayload> {
  const { info, prev, next } = weekNeighbors(weekKey);
  const key = schouwWeekValue(info.jaar, info.week);
  const { startIso, endIso } = weekBoundsIso(info.jaar, info.week);
  const { store } = await loadWeekmeetingStore(sb);
  const weekStore = store[key] || {};
  const prevStore = store[prev] || {};

  let adviseursRaw: {
    id: string;
    naam: string;
    email?: string | null;
    actief?: boolean | null;
    rol?: string | null;
    profielfoto_path?: string | null;
  }[] = [];

  {
    const withFoto = await sb
      .from("adviseurs")
      .select("id, naam, email, actief, rol, profielfoto_path")
      .eq("actief", true)
      .order("naam");
    if (
      withFoto.error &&
      (withFoto.error.message?.includes("profielfoto_path") ||
        withFoto.error.code === "42703")
    ) {
      const bare = await sb
        .from("adviseurs")
        .select("id, naam, email, actief, rol")
        .eq("actief", true)
        .order("naam");
      if (bare.error) throw bare.error;
      adviseursRaw = (bare.data || []) as typeof adviseursRaw;
    } else if (withFoto.error) {
      throw withFoto.error;
    } else {
      adviseursRaw = (withFoto.data || []) as typeof adviseursRaw;
    }
  }

  const adviseurs = adviseursRaw.filter((a) => isPlanbaarAdviseur(a));

  const ids = adviseurs.map((a) => a.id);
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, 0);

  if (ids.length > 0) {
    const { data: afs } = await sb
      .from("afspraken")
      .select("adviseur_id, start_at, status, soort")
      .in("adviseur_id", ids)
      .gte("start_at", startIso)
      .lt("start_at", endIso)
      .neq("status", "geannuleerd");

    for (const a of afs || []) {
      if (!afspraakBlokkeertAgenda(a.soort as string | null)) continue;
      const aid = a.adviseur_id as string;
      counts.set(aid, (counts.get(aid) || 0) + 1);
    }
  }

  const rows: WeekmeetingRow[] = adviseurs.map((a) => {
    const entry = weekStore[a.id] || emptyEntry();
    const prevEntry = prevStore[a.id];
    const afspraken = counts.get(a.id) || 0;
    const target =
      entry.target > 0 || weekStore[a.id] ? entry.target : null;
    const gehaald =
      target != null && target > 0 ? afspraken >= target : null;
    return {
      adviseur_id: a.id,
      naam: a.naam,
      profielfoto_url: publicProfielfotoUrl(sb, a.profielfoto_path),
      afspraken_week: afspraken,
      target: weekStore[a.id] ? entry.target : null,
      aandachtspunten: entry.aandachtspunten || "",
      aandachtspunten_vorige: prevEntry?.aandachtspunten?.trim() || "",
      gehaald,
    };
  });

  const mondayIso = schouwWeekToMondayIso(info.jaar, info.week);
  const rangeLabel = formatInTimeZone(
    mondayIso,
    AMSTERDAM_TZ,
    "'ma' d MMM"
  );

  return {
    weekKey: key,
    weekLabel: formatSchouwWeekLabel(info.jaar, info.week),
    weekNumber: info.week,
    jaar: info.jaar,
    rangeLabel,
    prevWeekKey: prev,
    nextWeekKey: next,
    rows,
  };
}

export async function upsertWeekmeetingEntry(
  sb: SupabaseClient,
  opts: {
    weekKey: string;
    adviseurId: string;
    target?: number | null;
    aandachtspunten?: string | null;
  }
): Promise<WeekmeetingPayload> {
  const parsed = parseWeekKey(opts.weekKey);
  if (!parsed) throw new Error("Ongeldige week (verwacht yyyy-Www)");
  const key = schouwWeekValue(parsed.jaar, parsed.week);

  const { id, store } = await loadWeekmeetingStore(sb);
  const week = { ...(store[key] || {}) };
  const cur = { ...(week[opts.adviseurId] || emptyEntry()) };

  if (opts.target !== undefined) {
    if (opts.target == null || opts.target < 0) {
      cur.target = 0;
    } else {
      cur.target = Math.round(Math.min(200, opts.target));
    }
  }
  if (opts.aandachtspunten !== undefined) {
    cur.aandachtspunten = (opts.aandachtspunten || "").trim();
  }

  week[opts.adviseurId] = cur;
  const next: WeekmeetingStore = { ...store, [key]: week };
  await saveWeekmeetingStore(sb, next, id);
  return buildWeekmeeting(sb, key);
}

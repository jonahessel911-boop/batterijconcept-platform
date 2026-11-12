/**
 * Slimme WF-slots obv. de Warmtefonds-agenda (warmtefonds_afspraak_at)
 * + reistijd vanaf vorige afspraak of thuisadres Edergy.
 */
import { addDays, addMinutes } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leesEdergyBedrijf, edergyThuisAdresVan } from "@/lib/edergy-bedrijf";
import { AMSTERDAM_TZ, adresRegel, formatSlotLabelNl } from "@/lib/format";
import {
  busyByDay,
  dayKeyAmsterdam,
  fitsWithTravelGap,
  type BusySlot,
} from "@/lib/partner-slots";
import { buildDurationMap } from "@/lib/travel-time";
import {
  isWarmtefondsPortalProject,
  WF_PORTAL_PROJECT_SELECT,
  WF_PORTAL_PROJECT_SELECT_MIN,
  isMissingWfProjectColumn,
} from "@/lib/warmtefonds-portal";

export const WF_AFSPRAAK_DUUR_MIN = 60;
export const WF_REIS_BUFFER_MIN = 15;
export const WF_SLOT_STEP_MIN = 30;
export const WF_DAG_START_HOUR = 9;
export const WF_DAG_EIND_HOUR = 17;

export type WfSlotOption = {
  slot_id: string;
  start_at: string;
  end_at: string;
  label_nl: string;
  label_kort: string;
  reistijd_min: number | null;
  reistijd_vanaf_startadres: boolean | null;
  reistijd_terug_min: number | null;
  agenda_afspraken: number;
  lege_agenda: boolean;
  feasible: boolean;
};

function isWeekdayAmsterdam(dayKey: string): boolean {
  const d = toZonedTime(new Date(`${dayKey}T12:00:00`), AMSTERDAM_TZ);
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

function candidateStarts(vanYmd: string, totYmd: string): Date[] {
  const out: Date[] = [];
  let cursor = vanYmd;
  const end = totYmd;
  while (cursor <= end) {
    if (isWeekdayAmsterdam(cursor)) {
      for (
        let min = WF_DAG_START_HOUR * 60;
        min + WF_AFSPRAAK_DUUR_MIN <= WF_DAG_EIND_HOUR * 60;
        min += WF_SLOT_STEP_MIN
      ) {
        const h = String(Math.floor(min / 60)).padStart(2, "0");
        const m = String(min % 60).padStart(2, "0");
        out.push(
          fromZonedTime(`${cursor}T${h}:${m}:00`, AMSTERDAM_TZ)
        );
      }
    }
    cursor = formatInTimeZone(
      addDays(fromZonedTime(`${cursor}T12:00:00`, AMSTERDAM_TZ), 1),
      AMSTERDAM_TZ,
      "yyyy-MM-dd"
    );
  }
  return out;
}

function leadAdres(lead: unknown): string {
  if (!lead) return "";
  const row = Array.isArray(lead) ? lead[0] : lead;
  if (!row || typeof row !== "object") return "";
  const a = adresRegel(
    row as {
      straat?: string | null;
      huisnummer?: string | null;
      toevoeging?: string | null;
      postcode?: string | null;
      plaats?: string | null;
    }
  );
  return a === "—" ? "" : a;
}

type AgendaStop = BusySlot & {
  project_id: string;
  address: string;
};

async function loadWfAgenda(
  sb: SupabaseClient,
  opts: { vanIso: string; totIso: string; excludeProjectId?: string }
): Promise<AgendaStop[]> {
  const primary = await sb
    .from("projecten")
    .select(WF_PORTAL_PROJECT_SELECT)
    .neq("status", "annulering")
    .not("warmtefonds_afspraak_at", "is", null)
    .gte("warmtefonds_afspraak_at", opts.vanIso)
    .lte("warmtefonds_afspraak_at", opts.totIso)
    .order("warmtefonds_afspraak_at", { ascending: true });

  let rows: unknown[] | null = primary.data;
  if (primary.error && isMissingWfProjectColumn(primary.error)) {
    const fallback = await sb
      .from("projecten")
      .select(WF_PORTAL_PROJECT_SELECT_MIN)
      .neq("status", "annulering")
      .not("warmtefonds_afspraak_at", "is", null)
      .gte("warmtefonds_afspraak_at", opts.vanIso)
      .lte("warmtefonds_afspraak_at", opts.totIso)
      .order("warmtefonds_afspraak_at", { ascending: true });
    if (fallback.error) throw fallback.error;
    rows = fallback.data;
  } else if (primary.error) {
    throw primary.error;
  }

  const stops: AgendaStop[] = [];
  for (const raw of rows || []) {
    const row = raw as {
      id?: string;
      status?: string | null;
      betaalwijze?: string | null;
      financiering_status?: string | null;
      warmtefonds_afspraak_at?: string | null;
      leads?: unknown;
    };
    if (!isWarmtefondsPortalProject(row)) continue;
    if (!row.id || !row.warmtefonds_afspraak_at) continue;
    if (opts.excludeProjectId && row.id === opts.excludeProjectId) continue;
    const start = new Date(row.warmtefonds_afspraak_at);
    if (Number.isNaN(start.getTime())) continue;
    const end = addMinutes(start, WF_AFSPRAAK_DUUR_MIN);
    stops.push({
      project_id: row.id,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      address: leadAdres(row.leads),
    });
  }
  return stops;
}

function scoreSlot(opts: {
  daysAhead: number;
  reistijdMin: number | null;
  agendaCount: number;
  hour: number;
}): number {
  // Lager = beter. Vroeg + weinig reis + dunne dag.
  const reis = opts.reistijdMin == null ? 45 : opts.reistijdMin;
  const uurBonus = opts.hour >= 10 && opts.hour <= 15 ? 0 : 8;
  return (
    opts.daysAhead * 12 +
    reis * 1.4 +
    opts.agendaCount * 18 +
    uurBonus
  );
}

export async function loadWarmtefondsBestSlots(
  sb: SupabaseClient,
  opts: {
    projectId: string;
    days?: number;
    limit?: number;
  }
): Promise<{
  slots: WfSlotOption[];
  days: Array<{ dayKey: string; slots: WfSlotOption[] }>;
  target_adres: string;
  thuis_adres: string;
  note: string | null;
}> {
  const days = Math.min(Math.max(opts.days ?? 14, 3), 28);
  const limit = Math.min(Math.max(opts.limit ?? 8, 3), 20);

  const projectRes = await sb
    .from("projecten")
    .select(
      `
      id, project_nummer, status, betaalwijze, financiering_status,
      leads(straat, huisnummer, toevoeging, postcode, plaats)
    `
    )
    .eq("id", opts.projectId)
    .maybeSingle();
  if (projectRes.error) throw projectRes.error;
  if (!projectRes.data) {
    return {
      slots: [],
      days: [],
      target_adres: "",
      thuis_adres: "",
      note: "Project niet gevonden",
    };
  }

  const targetAdres = leadAdres(projectRes.data.leads);
  const bedrijf = await leesEdergyBedrijf(sb);
  const thuis = edergyThuisAdresVan(bedrijf);

  const now = new Date();
  const vanYmd = formatInTimeZone(now, AMSTERDAM_TZ, "yyyy-MM-dd");
  const totYmd = formatInTimeZone(addDays(now, days), AMSTERDAM_TZ, "yyyy-MM-dd");
  const vanIso = fromZonedTime(`${vanYmd}T00:00:00`, AMSTERDAM_TZ).toISOString();
  const totIso = fromZonedTime(`${totYmd}T23:59:59`, AMSTERDAM_TZ).toISOString();

  const agenda = await loadWfAgenda(sb, {
    vanIso,
    totIso,
    excludeProjectId: opts.projectId,
  });
  const byDay = busyByDay(agenda);

  const candidates = candidateStarts(vanYmd, totYmd).filter(
    (start) => start.getTime() > now.getTime() + 60 * 60_000
  );

  // Adressen voor reistijd: thuis + target + alle agenda-adressen
  const addresses = new Set<string>();
  if (thuis) addresses.add(thuis);
  if (targetAdres) addresses.add(targetAdres);
  for (const s of agenda) {
    if (s.address) addresses.add(s.address);
  }
  const { durationMap } = await buildDurationMap([...addresses]);

  function travelMin(from: string, to: string): number | null {
    if (!from || !to) return null;
    if (from === to) return 0;
    const sec = durationMap.get(`${from}|||${to}`);
    if (sec == null) return null;
    return Math.max(1, Math.round(sec / 60));
  }

  type Ranked = WfSlotOption & { score: number };
  const ranked: Ranked[] = [];
  const byDayOut = new Map<string, WfSlotOption[]>();

  for (const start of candidates) {
    const end = addMinutes(start, WF_AFSPRAAK_DUUR_MIN);
    const dayKey = dayKeyAmsterdam(start);
    const dayStops = (byDay.get(dayKey) || []) as AgendaStop[];
    const sameDayStops = dayStops.map((s) => ({
      start: new Date(s.start_at),
      end: new Date(s.end_at),
    }));

    // Vind vorige/volgende stop voor reistijd
    let prev: AgendaStop | null = null;
    let next: AgendaStop | null = null;
    for (const s of dayStops) {
      if (new Date(s.end_at).getTime() <= start.getTime()) {
        if (!prev || new Date(s.end_at) > new Date(prev.end_at)) prev = s;
      }
      if (new Date(s.start_at).getTime() >= end.getTime()) {
        if (!next || new Date(s.start_at) < new Date(next.start_at)) next = s;
      }
    }

    const fromAdres = prev?.address || thuis;
    const reisNaar = targetAdres
      ? travelMin(fromAdres, targetAdres)
      : null;
    const reisTerug = targetAdres
      ? travelMin(targetAdres, next?.address || thuis)
      : null;

    const travelBefore =
      (reisNaar ?? WF_REIS_BUFFER_MIN) + WF_REIS_BUFFER_MIN;
    const travelAfter =
      (reisTerug ?? WF_REIS_BUFFER_MIN) + WF_REIS_BUFFER_MIN;

    const overlaps = sameDayStops.some((s) => {
      const cStart = start.getTime();
      const cEnd = end.getTime();
      return cStart < s.end.getTime() && cEnd > s.start.getTime();
    });
    if (overlaps) continue;

    const feasible = fitsWithTravelGap({
      candidateStart: start,
      candidateEnd: end,
      sameDayStops,
      travelMinBefore: prev ? travelBefore : 0,
      travelMinAfter: next ? travelAfter : 0,
    });

    const local = toZonedTime(start, AMSTERDAM_TZ);
    const daysAhead = Math.max(
      0,
      Math.round(
        (fromZonedTime(`${dayKey}T12:00:00`, AMSTERDAM_TZ).getTime() -
          fromZonedTime(`${vanYmd}T12:00:00`, AMSTERDAM_TZ).getTime()) /
          86_400_000
      )
    );
    const agendaCount = dayStops.length;
    const slot: WfSlotOption = {
      slot_id: `wf:${start.toISOString()}`,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      label_nl: formatSlotLabelNl(start),
      label_kort: formatSlotLabelNl(start, { kort: true }),
      reistijd_min: reisNaar,
      reistijd_vanaf_startadres: prev ? false : true,
      reistijd_terug_min: next ? reisTerug : travelMin(targetAdres, thuis),
      agenda_afspraken: agendaCount,
      lege_agenda: agendaCount === 0,
      feasible,
    };

    const list = byDayOut.get(dayKey) || [];
    list.push(slot);
    byDayOut.set(dayKey, list);

    if (!feasible) continue;
    ranked.push({
      ...slot,
      score: scoreSlot({
        daysAhead,
        reistijdMin: reisNaar,
        agendaCount,
        hour: local.getHours(),
      }),
    });
  }

  ranked.sort((a, b) => a.score - b.score || a.start_at.localeCompare(b.start_at));
  const best = ranked.slice(0, limit).map(({ score: _s, ...rest }) => rest);

  const daysOut = [...byDayOut.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, slots]) => ({
      dayKey,
      slots: slots.sort((a, b) => a.start_at.localeCompare(b.start_at)),
    }));

  return {
    slots: best,
    days: daysOut,
    target_adres: targetAdres,
    thuis_adres: thuis,
    note:
      best.length === 0
        ? targetAdres
          ? "Geen haalbare slots in dit venster — kies handmatig."
          : "Geen volledig adres op de lead — reistijd beperkt."
        : null,
  };
}

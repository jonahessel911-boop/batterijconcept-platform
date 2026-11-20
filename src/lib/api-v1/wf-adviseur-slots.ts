/**
 * Vrije WF-adviseur-slots (Acties) met reistijd vanaf Bunschoten
 * of de vorige WF-stop die dag.
 */

import { addMinutes } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AMSTERDAM_TZ, adresRegel } from "@/lib/format";
import {
  afspraakBlokkeertAgenda,
  isWarmtefondsAanvraagSoort,
} from "@/lib/afspraak-soort";
import { ensureEdwinVeenendaalAdviseur } from "@/lib/warmtefonds-koppeling";
import { generateDayBlocks, type BusySlot } from "@/lib/slots";
import { travelTimeBetween } from "@/lib/travel-time";
import {
  WF_ADVISEUR_SLOT_HOURS,
  WF_ADVISEUR_START_ADRES,
  WF_ADVISEUR_START_LABEL,
} from "@/lib/wf-adviseur-slots";

export type WfAdviseurSlot = {
  hour: number;
  start_at: string;
  end_at: string;
  busy: boolean;
  reistijd_min: number | null;
  reistijd_vanaf: "startadres" | "vorige_afspraak" | null;
  vorige_label: string | null;
};

export type WfAdviseurSlotDag = {
  day_key: string;
  slots: WfAdviseurSlot[];
};

export type WfAdviseurSlotsResult =
  | {
      ok: true;
      adviseur: { id: string; naam: string };
      start_adres: string;
      start_label: string;
      hours: number[];
      target_adres: string | null;
      days: WfAdviseurSlotDag[];
    }
  | { ok: false; status: number; error: string };

function dayKeyAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function hourAmsterdam(d: Date): number {
  return Number(formatInTimeZone(d, AMSTERDAM_TZ, "H"));
}

async function travelMin(
  from: string,
  to: string,
  cache: Map<string, number>
): Promise<number | null> {
  const key = `${from}|||${to}`;
  const hit = cache.get(key);
  if (hit != null) return hit;
  try {
    const leg = await travelTimeBetween(from, to);
    const mins = Math.max(0, Math.ceil(leg.durationSec / 60));
    cache.set(key, mins);
    return mins;
  } catch {
    return null;
  }
}

export async function loadWfAdviseurSlots(
  sb: SupabaseClient,
  opts: {
    leadId?: string | null;
    projectId?: string | null;
    daysAhead?: number;
  }
): Promise<WfAdviseurSlotsResult> {
  const edwinId = await ensureEdwinVeenendaalAdviseur(sb);
  if (!edwinId) {
    return {
      ok: false,
      status: 500,
      error: "Warmtefonds-adviseur niet gevonden",
    };
  }

  const { data: adviseur } = await sb
    .from("adviseurs")
    .select("id, naam")
    .eq("id", edwinId)
    .maybeSingle();

  let leadId = opts.leadId?.trim() || null;
  let excludeProjectId = opts.projectId?.trim() || null;
  if (!leadId && excludeProjectId) {
    const { data: p } = await sb
      .from("projecten")
      .select("lead_id")
      .eq("id", excludeProjectId)
      .maybeSingle();
    leadId = (p as { lead_id?: string } | null)?.lead_id || null;
  }
  if (leadId && !excludeProjectId) {
    const { data: p } = await sb
      .from("projecten")
      .select("id")
      .eq("lead_id", leadId)
      .neq("status", "annulering")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    excludeProjectId = (p as { id?: string } | null)?.id || null;
  }

  let targetAdres: string | null = null;
  if (leadId) {
    const { data: lead } = await sb
      .from("leads")
      .select("straat, huisnummer, toevoeging, postcode, plaats")
      .eq("id", leadId)
      .maybeSingle();
    if (lead) {
      const line = adresRegel(lead);
      targetAdres = line && line !== "—" ? line : null;
    }
  }

  const horizon = new Date();
  horizon.setDate(horizon.getDate() + (opts.daysAhead ?? 16) + 2);

  const { data: afs } = await sb
    .from("afspraken")
    .select(
      "start_at, end_at, soort, status, lead_id, leads(naam, straat, huisnummer, toevoeging, postcode, plaats)"
    )
    .eq("adviseur_id", edwinId)
    .neq("status", "geannuleerd")
    .neq("status", "voltooid")
    .lt("start_at", horizon.toISOString());

  const busy: BusySlot[] = [];
  for (const a of afs || []) {
    if (leadId && a.lead_id === leadId) continue;
    if (
      !isWarmtefondsAanvraagSoort(a.soort) &&
      !afspraakBlokkeertAgenda(a.soort)
    ) {
      continue;
    }
    busy.push({ start_at: a.start_at, end_at: a.end_at });
  }

  const { data: projecten } = await sb
    .from("projecten")
    .select("id, lead_id, warmtefonds_afspraak_at")
    .not("warmtefonds_afspraak_at", "is", null)
    .lt("warmtefonds_afspraak_at", horizon.toISOString());

  for (const p of projecten || []) {
    if (excludeProjectId && p.id === excludeProjectId) continue;
    if (leadId && p.lead_id === leadId) continue;
    const start = new Date(p.warmtefonds_afspraak_at as string);
    if (Number.isNaN(start.getTime())) continue;
    const already = busy.some(
      (b) => Math.abs(new Date(b.start_at).getTime() - start.getTime()) < 60_000
    );
    if (already) continue;
    busy.push({
      start_at: start.toISOString(),
      end_at: addMinutes(start, 120).toISOString(),
    });
  }

  const blocks = generateDayBlocks({
    daysAhead: opts.daysAhead ?? 16,
    busy,
    slotHours: WF_ADVISEUR_SLOT_HOURS,
  });

  type Stop = { start: Date; end: Date; address: string | null; label: string | null };
  const stopsByDay = new Map<string, Stop[]>();

  for (const a of afs || []) {
    if (leadId && a.lead_id === leadId) continue;
    if (!isWarmtefondsAanvraagSoort(a.soort)) continue;
    const start = new Date(a.start_at);
    const key = dayKeyAmsterdam(start);
    const rawLead = (a as { leads?: unknown }).leads;
    const lead = (Array.isArray(rawLead) ? rawLead[0] : rawLead) as {
      naam?: string | null;
      straat?: string | null;
      huisnummer?: string | null;
      toevoeging?: string | null;
      postcode?: string | null;
      plaats?: string | null;
    } | null;
    const line = lead ? adresRegel(lead) : "";
    const list = stopsByDay.get(key) ?? [];
    list.push({
      start,
      end: new Date(a.end_at),
      address: line && line !== "—" ? line : null,
      label: lead?.naam || lead?.plaats || null,
    });
    stopsByDay.set(key, list);
  }

  const travelCache = new Map<string, number>();
  const daysMap = new Map<string, WfAdviseurSlot[]>();

  for (const block of blocks) {
    const key = dayKeyAmsterdam(block.start);
    const hour = hourAmsterdam(block.start);
    const list = daysMap.get(key) ?? [];
    let reistijd: number | null = null;
    let vanaf: WfAdviseurSlot["reistijd_vanaf"] = null;
    let vorigeLabel: string | null = null;

    if (!block.busy && targetAdres) {
      const dayStops = (stopsByDay.get(key) || [])
        .filter((s) => s.end.getTime() <= block.start.getTime())
        .sort((a, b) => b.end.getTime() - a.end.getTime());
      const prev = dayStops[0];
      if (prev?.address) {
        reistijd = await travelMin(prev.address, targetAdres, travelCache);
        vanaf = "vorige_afspraak";
        vorigeLabel = prev.label;
      } else {
        reistijd = await travelMin(
          WF_ADVISEUR_START_ADRES,
          targetAdres,
          travelCache
        );
        vanaf = "startadres";
      }
    }

    list.push({
      hour,
      start_at: block.start.toISOString(),
      end_at: block.end.toISOString(),
      busy: block.busy,
      reistijd_min: reistijd,
      reistijd_vanaf: vanaf,
      vorige_label: vorigeLabel,
    });
    daysMap.set(key, list);
  }

  const days: WfAdviseurSlotDag[] = [...daysMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day_key, slots]) => ({
      day_key,
      slots: slots.sort((a, b) => a.hour - b.hour),
    }));

  return {
    ok: true,
    adviseur: {
      id: edwinId,
      naam: adviseur?.naam || "Edwin Veenendaal",
    },
    start_adres: WF_ADVISEUR_START_ADRES,
    start_label: WF_ADVISEUR_START_LABEL,
    hours: [...WF_ADVISEUR_SLOT_HOURS],
    target_adres: targetAdres,
    days,
  };
}

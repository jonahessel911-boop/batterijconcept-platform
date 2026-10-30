/**
 * Beste schouw-/installatie-slots over actieve montagepartners (14d).
 * Ranking: reistijd vanaf startadres (Cabrondom-fallback) + vroegste moment.
 */

import { addDays, addMinutes, differenceInCalendarDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AMSTERDAM_TZ, adresRegel, formatSlotLabelNl } from "@/lib/format";
import {
  installatieDuurVoorVenster,
  SCHOUW_DUUR_MINUTEN,
} from "@/lib/planning-duur";
import {
  DEFAULT_PARTNER_REISTIJD_BUFFER_MIN,
  busyByDay,
  dayKeyAmsterdam,
  fitsWithTravelGap,
  generateAvailablePartnerSlots,
  isPartnerVenster,
  vensterForStart,
  type BusySlot,
  type PartnerSlotSoort,
  type PartnerVenster,
} from "@/lib/partner-slots";
import { loadPartnerAfblokkingen } from "@/lib/partner-afblokkingen-db";
import { resolvePartnerStartAdres } from "@/lib/start-adres";
import { travelTimeBetween } from "@/lib/travel-time";

export type PartnerSlotTokenPayload = {
  v: 1;
  p: string; // partner_id
  s: string; // start_at ISO
  e: string; // end_at ISO
  k: PartnerSlotSoort;
};

export type BestPartnerSlotOption = {
  slot_id: string;
  start_at: string;
  end_at: string;
  venster: PartnerVenster;
  label_nl: string;
  label_kort: string;
  partner_id: string;
  partner_naam: string;
  soort: PartnerSlotSoort;
  reistijd_min: number | null;
  reistijd_vanaf_startadres: boolean;
  start_adres: string;
  start_adres_fallback: boolean;
};

function b64urlEncode(json: string): string {
  return Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecode(raw: string): string {
  const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64").toString("utf8");
}

export function encodePartnerSlotId(payload: PartnerSlotTokenPayload): string {
  return b64urlEncode(JSON.stringify(payload));
}

export function decodePartnerSlotId(
  slotId: string
): PartnerSlotTokenPayload | null {
  try {
    const parsed = JSON.parse(b64urlDecode(slotId)) as PartnerSlotTokenPayload;
    if (
      parsed?.v !== 1 ||
      typeof parsed.p !== "string" ||
      typeof parsed.s !== "string" ||
      typeof parsed.e !== "string" ||
      (parsed.k !== "schouw" && parsed.k !== "installatie")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isMissingCol(
  error: { code?: string; message?: string } | null,
  col: string
) {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    msg.includes(col) ||
    msg.includes("schema cache")
  );
}

type LeadAddr = {
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
};

function leadAddress(lead: LeadAddr | null | undefined): string | null {
  if (!lead) return null;
  const a = adresRegel(lead);
  return a && a !== "—" ? a : null;
}

export type LoadBestPartnerSlotsResult =
  | {
      ok: true;
      mode: "route" | "calendar";
      lead: { id: string; naam: string | null; adres: string | null };
      project_id: string | null;
      soort: PartnerSlotSoort;
      slots: BestPartnerSlotOption[];
      note: string | null;
    }
  | { ok: false; error: string; status: number; detail?: string };

export async function loadBestPartnerSlots(
  sb: SupabaseClient,
  opts: {
    projectId?: string | null;
    leadId?: string | null;
    soort?: PartnerSlotSoort;
    daysAhead?: number;
    limit?: number;
    partnerId?: string | null;
    /** Alleen slots strikt na deze ISO (bijv. na schouwdag) */
    afterIso?: string | null;
  }
): Promise<LoadBestPartnerSlotsResult> {
  const soort: PartnerSlotSoort =
    opts.soort === "installatie" ? "installatie" : "schouw";
  const daysAhead = Math.min(Math.max(opts.daysAhead ?? 14, 1), 60);
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20);
  const partnerLock = opts.partnerId?.trim() || null;
  const afterMs = opts.afterIso ? new Date(opts.afterIso).getTime() : null;

  let leadId = opts.leadId?.trim() || null;
  let projectId = opts.projectId?.trim() || null;
  let leadNaam: string | null = null;
  let targetAddress: string | null = null;
  let excludeProjectId: string | null = projectId;

  if (projectId) {
    const { data: proj, error: projErr } = await sb
      .from("projecten")
      .select(
        "id, lead_id, installatie_partner_id, leads(id, naam, straat, huisnummer, toevoeging, postcode, plaats)"
      )
      .eq("id", projectId)
      .maybeSingle();
    if (projErr) {
      return {
        ok: false,
        error: "Project laden mislukt",
        status: 500,
        detail: projErr.message,
      };
    }
    if (!proj) {
      return { ok: false, error: "Project niet gevonden", status: 404 };
    }
    leadId = (proj.lead_id as string) || leadId;
    const leadRaw = proj.leads as LeadAddr & { id?: string; naam?: string } | null | Array<LeadAddr & { id?: string; naam?: string }>;
    const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
    leadNaam = lead?.naam || null;
    targetAddress = leadAddress(lead);
    if (!partnerLock && proj.installatie_partner_id) {
      // voorkeur: zelfde partner als al gekozen, maar niet locken — ranking mag anderen tonen
    }
  }

  if (!leadId && !projectId) {
    return {
      ok: false,
      error: "project_id of lead_id is verplicht",
      status: 400,
    };
  }

  if (leadId && !targetAddress) {
    const { data: leadRow } = await sb
      .from("leads")
      .select("id, naam, straat, huisnummer, toevoeging, postcode, plaats")
      .eq("id", leadId)
      .maybeSingle();
    if (leadRow) {
      leadNaam = leadRow.naam || leadNaam;
      targetAddress = leadAddress(leadRow);
    }
  }

  let partnersRes = await sb
    .from("installatie_partners")
    .select("id, naam, start_adres, reistijd_buffer_min, actief")
    .eq("actief", true)
    .order("naam");
  if (partnersRes.error && isMissingCol(partnersRes.error, "start_adres")) {
    partnersRes = (await sb
      .from("installatie_partners")
      .select("id, naam, actief")
      .eq("actief", true)
      .order("naam")) as typeof partnersRes;
  }
  if (partnersRes.error) {
    return {
      ok: false,
      error: "Partners laden mislukt",
      status: 500,
      detail: partnersRes.error.message,
    };
  }

  type PartnerRow = {
    id: string;
    naam: string;
    start_adres?: string | null;
    reistijd_buffer_min?: number | null;
    actief?: boolean;
  };
  let partners = (partnersRes.data || []) as PartnerRow[];
  if (partnerLock) {
    partners = partners.filter((p) => p.id === partnerLock);
    if (partners.length === 0) {
      return {
        ok: false,
        error: "Partner niet gevonden of inactief",
        status: 404,
      };
    }
  }
  if (partners.length === 0) {
    return {
      ok: true,
      mode: "calendar",
      lead: { id: leadId || "", naam: leadNaam, adres: targetAddress },
      project_id: projectId,
      soort,
      slots: [],
      note: "Geen actieve montagepartners",
    };
  }

  const van = formatInTimeZone(new Date(), AMSTERDAM_TZ, "yyyy-MM-dd");
  const totDate = addDays(new Date(), daysAhead);
  const tot = formatInTimeZone(totDate, AMSTERDAM_TZ, "yyyy-MM-dd");
  const rangeStartIso = fromZonedTime(`${van}T00:00:00`, AMSTERDAM_TZ).toISOString();
  const rangeEndIso = fromZonedTime(`${tot}T23:59:59`, AMSTERDAM_TZ).toISOString();

  const partnerIds = partners.map((p) => p.id);

  const [{ data: projects }, afblokLoaded, teamRes] = await Promise.all([
    sb
      .from("projecten")
      .select(
        "id, schouw_at, installatie_at, installatie_partner_id, leads(straat, huisnummer, toevoeging, postcode, plaats)"
      )
      .in("installatie_partner_id", partnerIds)
      .or(
        `and(schouw_at.gte.${rangeStartIso},schouw_at.lte.${rangeEndIso}),and(installatie_at.gte.${rangeStartIso},installatie_at.lte.${rangeEndIso})`
      ),
    loadPartnerAfblokkingen(sb, { partnerIds, van, tot }),
    sb
      .from("installatie_partner_teamgenoten")
      .select("id, partner_id")
      .in("partner_id", partnerIds)
      .eq("actief", true),
  ]);

  const teamByPartner = new Map<string, string[]>();
  for (const t of teamRes.data || []) {
    const list = teamByPartner.get(t.partner_id) || [];
    list.push(t.id);
    teamByPartner.set(t.partner_id, list);
  }

  // Afblok map: partnerId → dayKey → Set<venster>
  const afblokByPartner = new Map<string, Map<string, Set<PartnerVenster>>>();
  for (const pid of partnerIds) {
    afblokByPartner.set(pid, new Map());
  }
  {
    const byPartnerDayVenster = new Map<
      string,
      { partnerWide: boolean; tgBlocked: Set<string> }
    >();
    for (const row of afblokLoaded.items) {
      if (!isPartnerVenster(row.venster)) continue;
      const k = `${row.partner_id}:${row.dag}:${row.venster}`;
      const cur = byPartnerDayVenster.get(k) || {
        partnerWide: false,
        tgBlocked: new Set<string>(),
      };
      if (!row.teamgenoot_id) cur.partnerWide = true;
      else cur.tgBlocked.add(row.teamgenoot_id);
      byPartnerDayVenster.set(k, cur);
    }
    for (const [k, info] of byPartnerDayVenster) {
      const [pid, dag, venster] = k.split(":") as [
        string,
        string,
        PartnerVenster,
      ];
      const activeTg = teamByPartner.get(pid) || [];
      const allTgBlocked =
        activeTg.length > 0 &&
        activeTg.every((id) => info.tgBlocked.has(id));
      if (info.partnerWide || allTgBlocked || !afblokLoaded.perMonteur) {
        if (!afblokLoaded.perMonteur && !info.partnerWide) continue;
        if (
          info.partnerWide ||
          allTgBlocked ||
          (!afblokLoaded.perMonteur && info.partnerWide)
        ) {
          const dayMap = afblokByPartner.get(pid) || new Map();
          const set = dayMap.get(dag) || new Set<PartnerVenster>();
          set.add(venster);
          dayMap.set(dag, set);
          afblokByPartner.set(pid, dayMap);
        }
      }
    }
    if (!afblokLoaded.perMonteur) {
      for (const row of afblokLoaded.items) {
        if (!isPartnerVenster(row.venster)) continue;
        const dayMap = afblokByPartner.get(row.partner_id) || new Map();
        const set = dayMap.get(row.dag) || new Set<PartnerVenster>();
        set.add(row.venster);
        dayMap.set(row.dag, set);
        afblokByPartner.set(row.partner_id, dayMap);
      }
    }
  }

  type BusyWithMeta = BusySlot & {
    kind: "schouw" | "installatie";
    partner_id: string;
  };
  const busyAll: BusyWithMeta[] = [];
  for (const row of projects || []) {
    if (excludeProjectId && row.id === excludeProjectId) continue;
    const pid = row.installatie_partner_id as string | null;
    if (!pid) continue;
    const leadRaw = row.leads as LeadAddr | LeadAddr[] | null;
    const leadObj = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
    const address = leadAddress(leadObj);
    if (row.schouw_at) {
      const start = new Date(row.schouw_at);
      if (!Number.isNaN(start.getTime())) {
        busyAll.push({
          start_at: start.toISOString(),
          end_at: addMinutes(start, SCHOUW_DUUR_MINUTEN).toISOString(),
          address,
          kind: "schouw",
          partner_id: pid,
        });
      }
    }
    if (row.installatie_at) {
      const start = new Date(row.installatie_at);
      if (!Number.isNaN(start.getTime())) {
        const duur = installatieDuurVoorVenster(vensterForStart(start));
        busyAll.push({
          start_at: start.toISOString(),
          end_at: addMinutes(start, duur).toISOString(),
          address,
          kind: "installatie",
          partner_id: pid,
        });
      }
    }
  }

  const travelCache = new Map<string, number>();
  async function travelMin(
    from: string | null,
    to: string | null,
    fallback: number
  ): Promise<number> {
    if (!from || !to || from === to) return 0;
    const key = `${from}|||${to}`;
    const cached = travelCache.get(key);
    if (cached != null) return cached;
    try {
      const leg = await travelTimeBetween(from, to);
      const mins = Math.max(0, Math.ceil(leg.durationSec / 60));
      travelCache.set(key, mins);
      return mins;
    } catch {
      travelCache.set(key, fallback);
      return fallback;
    }
  }

  const now = new Date();
  const fromDate = fromZonedTime(`${van}T00:00:00`, AMSTERDAM_TZ);
  const slotFrom = fromDate.getTime() > now.getTime() ? fromDate : now;
  const daysSpan = Math.max(
    0,
    differenceInCalendarDays(
      fromZonedTime(`${tot}T12:00:00`, AMSTERDAM_TZ),
      slotFrom
    )
  );

  type Cand = BestPartnerSlotOption & { score: number };
  const candidates: Cand[] = [];

  for (const partner of partners) {
    const resolved = resolvePartnerStartAdres(partner.start_adres);
    const bufferMin =
      typeof partner.reistijd_buffer_min === "number" &&
      partner.reistijd_buffer_min >= 0
        ? partner.reistijd_buffer_min
        : DEFAULT_PARTNER_REISTIJD_BUFFER_MIN;

    const partnerBusy = busyAll.filter((b) => b.partner_id === partner.id);
    const afblokMap = afblokByPartner.get(partner.id) || new Map();

    const free = generateAvailablePartnerSlots({
      soort,
      daysAhead: daysSpan,
      busy: partnerBusy,
      afblokkingen: afblokMap,
      fromDate: slotFrom,
    }).filter((s) => {
      const key = dayKeyAmsterdam(s.start);
      if (key < van || key > tot) return false;
      if (afterMs != null && !Number.isNaN(afterMs) && s.start.getTime() <= afterMs) {
        return false;
      }
      return true;
    });

    // Reistijd startadres → klant (één keer per partner)
    const baseTravel = targetAddress
      ? await travelMin(resolved.address, targetAddress, bufferMin)
      : bufferMin;

    const byDay = busyByDay(partnerBusy);

    for (const slot of free) {
      const dayKey = dayKeyAmsterdam(slot.start);
      const dayStops = (byDay.get(dayKey) || []).map((b) => ({
        start: new Date(b.start_at),
        end: new Date(b.end_at),
        address: b.address || null,
      }));

      let travelBefore = bufferMin;
      let travelAfter = bufferMin;
      let fromStart = true;
      let shownTravel: number | null = baseTravel;

      if (targetAddress) {
        const prev = [...dayStops]
          .filter((s) => s.end.getTime() <= slot.start.getTime())
          .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
        const next = [...dayStops]
          .filter((s) => s.start.getTime() >= slot.end.getTime())
          .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
        const fromAddr = prev?.address || resolved.address;
        travelBefore = fromAddr
          ? await travelMin(fromAddr, targetAddress, bufferMin)
          : bufferMin;
        travelAfter = next?.address
          ? await travelMin(targetAddress, next.address, bufferMin)
          : bufferMin;
        shownTravel = travelBefore;
        fromStart = !prev?.address;
      } else {
        travelBefore = dayStops.length ? bufferMin : 0;
        travelAfter = dayStops.length ? bufferMin : 0;
        shownTravel = null;
      }

      const fits = fitsWithTravelGap({
        candidateStart: slot.start,
        candidateEnd: slot.end,
        sameDayStops: dayStops.map((s) => ({ start: s.start, end: s.end })),
        travelMinBefore: travelBefore,
        travelMinAfter: travelAfter,
      });
      if (!fits) continue;

      const startIso = slot.start.toISOString();
      const endIso = slot.end.toISOString();
      // Score: lagere reistijd eerst, dan vroeger; bonus als al stop op die dag
      const clusterBonus = dayStops.length > 0 ? -15 : 0;
      const score =
        (shownTravel ?? bufferMin) +
        clusterBonus +
        slot.start.getTime() / 1e12;

      candidates.push({
        slot_id: encodePartnerSlotId({
          v: 1,
          p: partner.id,
          s: startIso,
          e: endIso,
          k: soort,
        }),
        start_at: startIso,
        end_at: endIso,
        venster: slot.venster,
        label_nl: formatSlotLabelNl(startIso),
        label_kort: formatSlotLabelNl(startIso, { kort: true }),
        partner_id: partner.id,
        partner_naam: partner.naam,
        soort,
        reistijd_min: shownTravel,
        reistijd_vanaf_startadres: fromStart,
        start_adres: resolved.address,
        start_adres_fallback: resolved.isFallback,
        score,
      });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  const slots = candidates.slice(0, limit).map(({ score: _s, ...rest }) => rest);

  return {
    ok: true,
    mode: targetAddress ? "route" : "calendar",
    lead: { id: leadId || "", naam: leadNaam, adres: targetAddress },
    project_id: projectId,
    soort,
    slots,
    note:
      slots.length === 0
        ? "Geen vrije partner-slots in dit venster"
        : targetAddress
          ? "Gesorteerd op reistijd en vroegste moment (2 weken)"
          : "Geen klantadres — kalender-volgorde zonder reistijd",
  };
}

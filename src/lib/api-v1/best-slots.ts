/**
 * Moment-first slots voor agents (Retell):
 * beste tijden over alle actieve adviseurs, met Fast Direction / reistijd.
 * Adviseur zit in een opaque slot_id — agent hoeft die niet te kennen.
 */

import { addDays, getISOWeekYear } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdminAdviseur } from "@/lib/admin-adviseur";
import {
  dayKeyAmsterdam,
  filterSlotsByAfblokkingen,
  filterSlotsByBeschikbaarheid,
  loadAfblokkingen,
  loadUnavailableWeekKeys,
} from "@/lib/adviseur-beschikbaarheid";
import { blockingBusySlots } from "@/lib/afspraak-busy";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";
import {
  pickTopFastDirectionSlots,
  uniqueAddresses,
  type FastDirectionStop,
} from "@/lib/fast-direction";
import { AMSTERDAM_TZ, adresRegel, formatSlotLabelSpokenNl } from "@/lib/format";
import { generateAvailableSlots } from "@/lib/slots";
import { buildDurationMap } from "@/lib/travel-time";

export type SlotTokenPayload = {
  v: 1;
  a: string; // adviseur_id
  s: string; // start_at ISO
  e: string; // end_at ISO
};

export type BestSlotOption = {
  /** Opaque id om te boeken — agent mag dit niet voorlezen */
  slot_id: string;
  start_at: string;
  end_at: string;
  label_nl: string;
  label_kort: string;
  /** Alleen voor logging / CRM; niet voorlezen aan klant */
  adviseur_id: string;
  adviseur_naam: string;
  feasible: boolean;
  reason: string | null;
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

export function encodeSlotId(payload: SlotTokenPayload): string {
  return b64urlEncode(JSON.stringify(payload));
}

export function decodeSlotId(slotId: string): SlotTokenPayload | null {
  try {
    const parsed = JSON.parse(b64urlDecode(slotId)) as SlotTokenPayload;
    if (
      parsed?.v !== 1 ||
      typeof parsed.a !== "string" ||
      typeof parsed.s !== "string" ||
      typeof parsed.e !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function labelNl(iso: string): string {
  return formatSlotLabelSpokenNl(iso);
}

function labelKort(iso: string): string {
  return formatSlotLabelSpokenNl(iso, { kort: true });
}

type AdviseurRow = {
  id: string;
  naam: string;
  email: string | null;
  actief: boolean | null;
  start_adres: string | null;
};

type LeadRow = {
  id: string;
  naam: string | null;
  adviseur_id: string | null;
  straat: string | null;
  huisnummer: string | null;
  toevoeging: string | null;
  postcode: string | null;
  plaats: string | null;
};

async function freeSlotsForAdviseur(
  sb: SupabaseClient,
  adviseurId: string,
  daysAhead: number
): Promise<{ start_at: string; end_at: string }[]> {
  const busyRows = await blockingBusySlots(sb, adviseurId);
  const rawSlots = generateAvailableSlots({
    busy: busyRows,
    daysAhead,
  }).map((s) => ({
    start_at: s.start.toISOString(),
    end_at: s.end.toISOString(),
  }));

  const nowLocal = toZonedTime(new Date(), AMSTERDAM_TZ);
  const y = getISOWeekYear(nowLocal);
  const unavailable = await loadUnavailableWeekKeys(sb, adviseurId, [
    y - 1,
    y,
    y + 1,
  ]);
  const van = dayKeyAmsterdam(new Date());
  const tot = dayKeyAmsterdam(addDays(new Date(), daysAhead + 5));
  const afgeblokt = await loadAfblokkingen(sb, {
    adviseurIds: [adviseurId],
    van,
    tot,
  });

  return filterSlotsByAfblokkingen(
    filterSlotsByBeschikbaarheid(rawSlots, unavailable),
    adviseurId,
    afgeblokt
  );
}

function stopsForAdviseur(
  afspraken: {
    adviseur_id: string;
    start_at: string;
    end_at: string | null;
    status: string | null;
    soort: string | null;
    leads:
      | {
          naam: string | null;
          straat: string | null;
          huisnummer: string | null;
          toevoeging: string | null;
          postcode: string | null;
          plaats: string | null;
        }
      | {
          naam: string | null;
          straat: string | null;
          huisnummer: string | null;
          toevoeging: string | null;
          postcode: string | null;
          plaats: string | null;
        }[]
      | null;
  }[],
  adviseurId: string
): FastDirectionStop[] {
  const out: FastDirectionStop[] = [];
  for (const a of afspraken) {
    if (a.adviseur_id !== adviseurId) continue;
    if (a.status === "geannuleerd" || a.status === "voltooid") continue;
    if (!afspraakBlokkeertAgenda(a.soort)) continue;
    const L = Array.isArray(a.leads) ? a.leads[0] : a.leads;
    if (!L) continue;
    const address = adresRegel(L);
    if (address === "—") continue;
    out.push({
      start_at: a.start_at,
      end_at: a.end_at || a.start_at,
      address,
      label: L.naam || "Afspraak",
    });
  }
  return out;
}

/**
 * Beste huisbezoek-momenten voor een lead over alle actieve adviseurs.
 * Moment eerst; adviseur zit in slot_id.
 */
export async function loadBestSlotsForLead(
  sb: SupabaseClient,
  opts: {
    leadId: string;
    daysAhead?: number;
    limit?: number;
  }
): Promise<
  | {
      ok: true;
      lead: { id: string; naam: string | null; adres: string };
      slots: BestSlotOption[];
      slots_tekst: string;
      mode: "route" | "calendar";
      note: string;
    }
  | { ok: false; status: number; error: string; detail?: string }
> {
  const daysAhead = Math.min(Math.max(opts.daysAhead ?? 21, 1), 60);
  const limit = Math.min(Math.max(opts.limit ?? 6, 1), 20);

  const { data: lead, error: leadErr } = await sb
    .from("leads")
    .select(
      "id, naam, adviseur_id, straat, huisnummer, toevoeging, postcode, plaats"
    )
    .eq("id", opts.leadId)
    .maybeSingle();

  if (leadErr) {
    return {
      ok: false,
      status: 500,
      error: "Lead laden mislukt",
      detail: leadErr.message,
    };
  }
  if (!lead) {
    return { ok: false, status: 404, error: "Lead niet gevonden" };
  }

  const leadRow = lead as LeadRow;
  const targetAddress = adresRegel(leadRow);
  if (targetAddress === "—") {
    return {
      ok: false,
      status: 400,
      error:
        "Lead heeft geen (volledig) adres — nodig voor reistijd / beste slots",
    };
  }

  const { data: adviseursRaw, error: advErr } = await sb
    .from("adviseurs")
    .select("id, naam, email, actief, start_adres")
    .eq("actief", true)
    .order("naam");

  let adviseursList = (adviseursRaw || []) as AdviseurRow[];
  if (advErr) {
    const missingStart =
      advErr.message?.includes("start_adres") ||
      advErr.code === "42703";
    if (!missingStart) {
      return {
        ok: false,
        status: 500,
        error: "Adviseurs laden mislukt",
        detail: advErr.message,
      };
    }
    const { data: fallback, error: fbErr } = await sb
      .from("adviseurs")
      .select("id, naam, email, actief")
      .eq("actief", true)
      .order("naam");
    if (fbErr) {
      return {
        ok: false,
        status: 500,
        error: "Adviseurs laden mislukt",
        detail: fbErr.message,
      };
    }
    adviseursList = ((fallback || []) as AdviseurRow[]).map((a) => ({
      ...a,
      start_adres: null,
    }));
  }

  const adviseurs = adviseursList.filter((a) => !isAdminAdviseur(a));
  if (adviseurs.length === 0) {
    return { ok: false, status: 404, error: "Geen actieve adviseurs" };
  }

  const fromIso = new Date().toISOString();
  const toIso = addDays(new Date(), daysAhead + 2).toISOString();
  const { data: afsprakenRaw } = await sb
    .from("afspraken")
    .select(
      "adviseur_id, start_at, end_at, status, soort, leads(naam, straat, huisnummer, toevoeging, postcode, plaats)"
    )
    .gte("start_at", fromIso)
    .lte("start_at", toIso)
    .in(
      "adviseur_id",
      adviseurs.map((a) => a.id)
    );

  type Candidate = BestSlotOption & {
    scoreSec: number;
    dayKey: string;
    preferred: boolean;
  };

  const candidates: Candidate[] = [];
  let usedRoute = false;

  for (const adv of adviseurs) {
    const free = (await freeSlotsForAdviseur(sb, adv.id, daysAhead)).slice(
      0,
      40
    );
    if (free.length === 0) continue;

    const stops = stopsForAdviseur(afsprakenRaw || [], adv.id);
    const preferred = leadRow.adviseur_id === adv.id;

    let scored:
      | ReturnType<typeof pickTopFastDirectionSlots>
      | null = null;

    try {
      const addresses = uniqueAddresses(
        targetAddress,
        stops,
        adv.start_adres,
        12
      );
      if (addresses.length >= 1) {
        const { durationMap, distanceMap } = await buildDurationMap(addresses);
        scored = pickTopFastDirectionSlots(
          {
            targetAddress,
            freeSlots: free,
            stops,
            depotAddress: adv.start_adres,
            depotLabel: adv.naam,
            durationSecBetween: (from, to) => {
              if (from === to) return 0;
              return durationMap.get(`${from}|||${to}`) ?? null;
            },
            distanceMBetween: (from, to) => {
              if (from === to) return 0;
              return distanceMap.get(`${from}|||${to}`) ?? null;
            },
          },
          5
        );
        if (scored.length > 0) usedRoute = true;
      }
    } catch {
      scored = null;
    }

    if (scored && scored.length > 0) {
      for (const s of scored) {
        candidates.push({
          slot_id: encodeSlotId({
            v: 1,
            a: adv.id,
            s: s.start_at,
            e: s.end_at,
          }),
          start_at: s.start_at,
          end_at: s.end_at,
          label_nl: labelNl(s.start_at),
          label_kort: labelKort(s.start_at),
          adviseur_id: adv.id,
          adviseur_naam: adv.naam,
          feasible: s.feasible,
          reason: s.reason || null,
          scoreSec: s.scoreSec,
          dayKey: s.dayKey,
          preferred,
        });
      }
    } else {
      // Fallback: kalender-slots (geen reistijd)
      for (const s of free.slice(0, 8)) {
        const dayKey = formatInTimeZone(
          new Date(s.start_at),
          AMSTERDAM_TZ,
          "yyyy-MM-dd"
        );
        candidates.push({
          slot_id: encodeSlotId({
            v: 1,
            a: adv.id,
            s: s.start_at,
            e: s.end_at,
          }),
          start_at: s.start_at,
          end_at: s.end_at,
          label_nl: labelNl(s.start_at),
          label_kort: labelKort(s.start_at),
          adviseur_id: adv.id,
          adviseur_naam: adv.naam,
          feasible: true,
          reason: null,
          scoreSec: 0,
          dayKey,
          preferred,
        });
      }
    }
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      status: 404,
      error: "Geen vrije momenten gevonden bij adviseurs",
    };
  }

  // Per wandklok-moment: beste adviseur (feasible → preferred → score)
  const byMoment = new Map<string, Candidate>();
  for (const c of candidates) {
    const cur = byMoment.get(c.start_at);
    if (!cur) {
      byMoment.set(c.start_at, c);
      continue;
    }
    const better =
      Number(c.feasible) - Number(cur.feasible) ||
      Number(c.preferred) - Number(cur.preferred) ||
      cur.scoreSec - c.scoreSec;
    if (better > 0) byMoment.set(c.start_at, c);
  }

  const ranked = [...byMoment.values()].sort((a, b) => {
    // Feasible eerst, dan vroegste dag, dan score, dan preferred
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (a.dayKey !== b.dayKey) return a.dayKey.localeCompare(b.dayKey);
    if (a.scoreSec !== b.scoreSec) return a.scoreSec - b.scoreSec;
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    return a.start_at.localeCompare(b.start_at);
  });

  // Max 1 slot per dag in de top (zoals Fast Direction)
  const onePerDay: Candidate[] = [];
  const seenDays = new Set<string>();
  for (const c of ranked) {
    if (seenDays.has(c.dayKey)) continue;
    seenDays.add(c.dayKey);
    onePerDay.push(c);
    if (onePerDay.length >= limit) break;
  }

  // Vul aan met volgende beste momenten als we te weinig dagen hebben
  if (onePerDay.length < limit) {
    for (const c of ranked) {
      if (onePerDay.some((x) => x.start_at === c.start_at)) continue;
      onePerDay.push(c);
      if (onePerDay.length >= limit) break;
    }
  }

  const slots: BestSlotOption[] = onePerDay.map(
    ({ scoreSec: _s, dayKey: _d, preferred: _p, ...rest }) => rest
  );

  const slots_tekst = slots
    .map((s, i) => `${i + 1}. ${s.label_nl}`)
    .join(". ");

  return {
    ok: true,
    lead: { id: leadRow.id, naam: leadRow.naam, adres: targetAddress },
    slots,
    slots_tekst: slots_tekst || "Geen vrije momenten gevonden",
    mode: usedRoute ? "route" : "calendar",
    note:
      "Bied alleen label_nl aan. Boek met slot_id via POST /api/v1/afspraken (adviseur wordt automatisch gekoppeld).",
  };
}

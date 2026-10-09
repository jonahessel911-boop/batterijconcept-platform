/**
 * Moment-first slots voor agents (Retell):
 * beste tijden over alle actieve adviseurs, met Fast Direction / reistijd.
 * Adviseur zit in een opaque slot_id — agent hoeft die niet te kennen.
 */

import { addDays, getISOWeekYear } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
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
import { AMSTERDAM_TZ, adresRegel, formatSlotLabelNl, formatSlotLabelSpokenNl } from "@/lib/format";
import { generateAvailableSlots } from "@/lib/slots";
import { buildDurationMap } from "@/lib/travel-time";
import { loadAdviseurConversieMap } from "@/lib/adviseur-conversie";

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
  /** Sales-conversie (voltooid → deal), % over ~90 dagen; null = onbekend */
  conversie_pct: number | null;
  /** Echte reistijd in minuten vanaf startadres/vorige stop (null = onbekend) */
  reistijd_min: number | null;
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
  // Spoken voor TTS / Fonio
  return formatSlotLabelSpokenNl(iso);
}

function labelKort(iso: string): string {
  // Cijfers voor CRM-UI: "zat 3 okt. om 19:00"
  return formatSlotLabelNl(iso, { kort: true });
}

function hourAmsterdam(iso: string): number {
  return Number(formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "H"));
}

function dayKeyAmsterdamIso(iso: string): string {
  return formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "yyyy-MM-dd");
}

/** Agenda-blokken: 10 ochtend, 13/16 middag, 19 avond. */
export type FonioDagdeel = "ochtend" | "middag" | "avond";

export function dagdeelVanHour(hour: number): FonioDagdeel | null {
  if (hour === 10) return "ochtend";
  if (hour === 13 || hour === 16) return "middag";
  if (hour === 19) return "avond";
  return null;
}

/**
 * Top 3 voor Fonio: 3 verschillende (vroegste) dagen ×
 * 1 ochtend (10) + 1 middag (13 of 16) + 1 avond (19).
 */
export function pickFonioDaypartSlots<T extends { start_at: string }>(
  pool: T[]
): T[] {
  if (pool.length === 0) return [];
  const sorted = [...pool].sort((a, b) => a.start_at.localeCompare(b.start_at));

  const usedDays = new Set<string>();
  const picked: T[] = [];

  const pickFirst = (pred: (s: T) => boolean): T | null => {
    for (const s of sorted) {
      const day = dayKeyAmsterdamIso(s.start_at);
      if (usedDays.has(day)) continue;
      if (!pred(s)) continue;
      usedDays.add(day);
      return s;
    }
    return null;
  };

  const ochtend = pickFirst((s) => hourAmsterdam(s.start_at) === 10);
  if (ochtend) picked.push(ochtend);

  const middag = pickFirst((s) => {
    const h = hourAmsterdam(s.start_at);
    return h === 13 || h === 16;
  });
  if (middag) picked.push(middag);

  const avond = pickFirst((s) => hourAmsterdam(s.start_at) === 19);
  if (avond) picked.push(avond);

  // Tekort? Vul met vroegste vrije slot op nog ongebruikte dag
  if (picked.length < 3) {
    for (const s of sorted) {
      if (picked.length >= 3) break;
      const day = dayKeyAmsterdamIso(s.start_at);
      if (usedDays.has(day)) continue;
      if (picked.some((p) => p.start_at === s.start_at)) continue;
      usedDays.add(day);
      picked.push(s);
    }
  }

  return picked.sort((a, b) => a.start_at.localeCompare(b.start_at));
}

/** Filter pool op dagdeel / weekdag / datum (klantvoorkeur). */
export function filterSlotsByVoorkeur<T extends { start_at: string }>(
  pool: T[],
  voorkeur: {
    dagdeel?: FonioDagdeel | null;
    /** 1=ma … 7=zo (ISO) */
    weekday?: number | null;
    /** yyyy-MM-dd */
    date?: string | null;
  }
): T[] {
  return pool.filter((s) => {
    const h = hourAmsterdam(s.start_at);
    const deel = dagdeelVanHour(h);
    if (voorkeur.dagdeel && deel !== voorkeur.dagdeel) return false;
    if (voorkeur.date) {
      if (dayKeyAmsterdamIso(s.start_at) !== voorkeur.date) return false;
    }
    if (voorkeur.weekday != null) {
      const wd = Number(
        formatInTimeZone(new Date(s.start_at), AMSTERDAM_TZ, "i")
      ); // 1–7
      if (wd !== voorkeur.weekday) return false;
    }
    return true;
  });
}

/** Parse losse voorkeur-tekst uit Fonio ("dinsdagavond", "morgen ochtend", …). */
export function parseFonioVoorkeur(raw: string | null | undefined): {
  dagdeel?: FonioDagdeel;
  weekday?: number;
  date?: string;
} {
  if (!raw?.trim()) return {};
  const t = raw.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const out: { dagdeel?: FonioDagdeel; weekday?: number; date?: string } = {};

  if (/ochtend|10\s*uur/.test(t)) out.dagdeel = "ochtend";
  else if (/avond|19\s*uur/.test(t)) out.dagdeel = "avond";
  else if (/middag|13\s*uur|16\s*uur|dertien|zestien/.test(t))
    out.dagdeel = "middag";

  const days: Record<string, number> = {
    maandag: 1,
    dinsdag: 2,
    woensdag: 3,
    donderdag: 4,
    vrijdag: 5,
    zaterdag: 6,
    zondag: 7,
  };
  for (const [name, n] of Object.entries(days)) {
    if (t.includes(name)) {
      out.weekday = n;
      break;
    }
  }

  const iso = t.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) out.date = iso[1];

  return out;
}

/** @deprecated alias — gebruik pickFonioDaypartSlots */
export function pickDiverseEarlySlots<T extends { start_at: string }>(
  pool: T[],
  limit = 3
): T[] {
  const picked = pickFonioDaypartSlots(pool);
  return picked.slice(0, limit);
}

type AdviseurRow = {
  id: string;
  naam: string;
  email: string | null;
  actief: boolean | null;
  start_adres: string | null;
  factuur_adres?: string | null;
  factuur_postcode?: string | null;
  factuur_plaats?: string | null;
  rol?: string | null;
  bel_planning?: boolean | null;
};

/** Vertrekpunt voor reistijd: startadres, anders factuuradres. */
function resolveDepotAddress(adv: AdviseurRow): string | null {
  const start = adv.start_adres?.trim() || "";
  if (start && start !== "—") return start;
  const straat = adv.factuur_adres?.trim() || "";
  const pc = adv.factuur_postcode?.trim() || "";
  const plaats = adv.factuur_plaats?.trim() || "";
  if (!straat && !pc && !plaats) return null;
  // Placeholder/junk like "straat"/"Postcode" overslaan
  const junk = /^(straat|adres|postcode|plaats)$/i;
  if (junk.test(straat) || junk.test(pc) || junk.test(plaats)) return null;
  const cityLine = [pc, plaats].filter(Boolean).join(" ");
  const composed = [straat, cityLine].filter(Boolean).join(", ");
  return composed || null;
}

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
    /**
     * Fonio: haal een pool op en kies top-N met vroege datums + gevarieerde tijden
     * (niet 3× dezelfde ochtendslot).
     */
    diversifyHours?: boolean;
    /** Grootte van de kandidaat-pool bij diversifyHours (default 14). */
    poolSize?: number;
    /** Beperk tot één adviseur (eigen agenda). */
    adviseurId?: string | null;
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
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);
  const diversifyHours = Boolean(opts.diversifyHours);
  const poolSize = Math.min(
    Math.max(opts.poolSize ?? (diversifyHours ? 14 : limit), limit),
    40
  );

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
    .select(
      "id, naam, email, actief, start_adres, factuur_adres, factuur_postcode, factuur_plaats, rol"
    )
    .eq("actief", true)
    .order("naam");

  let adviseursList = (adviseursRaw || []) as AdviseurRow[];
  if (advErr) {
    const missingCol =
      advErr.message?.includes("start_adres") ||
      advErr.message?.includes("factuur_") ||
      advErr.message?.includes("rol") ||
      advErr.code === "42703";
    if (!missingCol) {
      return {
        ok: false,
        status: 500,
        error: "Adviseurs laden mislukt",
        detail: advErr.message,
      };
    }
    const { data: fallback, error: fbErr } = await sb
      .from("adviseurs")
      .select("id, naam, email, actief, start_adres")
      .eq("actief", true)
      .order("naam");
    if (fbErr) {
      const { data: minFb, error: minErr } = await sb
        .from("adviseurs")
        .select("id, naam, email, actief")
        .eq("actief", true)
        .order("naam");
      if (minErr) {
        return {
          ok: false,
          status: 500,
          error: "Adviseurs laden mislukt",
          detail: minErr.message,
        };
      }
      adviseursList = ((minFb || []) as AdviseurRow[]).map((a) => ({
        ...a,
        start_adres: null,
        rol: "adviseur",
      }));
    } else {
      adviseursList = ((fallback || []) as AdviseurRow[]).map((a) => ({
        ...a,
        rol: "adviseur",
      }));
    }
  }

  let adviseurs = adviseursList.filter((a) => isPlanbaarAdviseur(a));
  const onlyAdviseurId = opts.adviseurId?.trim() || "";
  if (onlyAdviseurId) {
    adviseurs = adviseurs.filter((a) => a.id === onlyAdviseurId);
    if (adviseurs.length === 0) {
      // Eigen account mag altijd — ook als rol/filter anders zou uitsluiten.
      const self = adviseursList.find((a) => a.id === onlyAdviseurId);
      if (self) adviseurs = [self];
    }
  }
  if (adviseurs.length === 0) {
    return { ok: false, status: 404, error: "Geen actieve adviseurs" };
  }

  const conversieMap = await loadAdviseurConversieMap(
    sb,
    adviseurs.map((a) => a.id)
  );
  const conversieRate = (adviseurId: string) =>
    conversieMap.get(adviseurId)?.rate ?? 0;
  const conversiePct = (adviseurId: string) => {
    const row = conversieMap.get(adviseurId);
    if (!row || row.uitgevoerd === 0) return null;
    return row.pct;
  };

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
    conversie: number;
    /** Open agenda-druk in venster (lager = eerder vullen). */
    workload: number;
  };

  // Agenda-druk per adviseur: open afspraken in het venster (gelijke vulling).
  const workloadByAdviseur = new Map<string, number>();
  for (const a of adviseurs) workloadByAdviseur.set(a.id, 0);
  for (const row of afsprakenRaw || []) {
    const r = row as {
      adviseur_id?: string | null;
      status?: string | null;
      soort?: string | null;
    };
    if (!r.adviseur_id) continue;
    if (r.status === "geannuleerd" || r.status === "voltooid") continue;
    if (!afspraakBlokkeertAgenda(r.soort)) continue;
    workloadByAdviseur.set(
      r.adviseur_id,
      (workloadByAdviseur.get(r.adviseur_id) || 0) + 1
    );
  }

  const candidates: Candidate[] = [];
  let usedRoute = false;

  for (const adv of adviseurs) {
    const freeCap = diversifyHours ? 80 : 40;
    const free = (await freeSlotsForAdviseur(sb, adv.id, daysAhead)).slice(
      0,
      freeCap
    );
    if (free.length === 0) continue;

    const stops = stopsForAdviseur(afsprakenRaw || [], adv.id);
    const preferred = leadRow.adviseur_id === adv.id;
    const conversie = conversieRate(adv.id);
    const convPct = conversiePct(adv.id);
    const workload = workloadByAdviseur.get(adv.id) || 0;

    let scored:
      | ReturnType<typeof pickTopFastDirectionSlots>
      | null = null;

    const depotAddress = resolveDepotAddress(adv);
    try {
      const addresses = uniqueAddresses(
        targetAddress,
        stops,
        depotAddress,
        12
      );
      if (addresses.length >= 1) {
        const { durationMap, distanceMap } = await buildDurationMap(addresses);
        scored = pickTopFastDirectionSlots(
          {
            targetAddress,
            freeSlots: free,
            stops,
            depotAddress,
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
          diversifyHours ? 14 : 5
        );
        if (scored.some((s) => s.fromDurationSec != null || s.toDurationSec != null)) {
          usedRoute = true;
        }
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
          conversie_pct: convPct,
          // Alleen echte route-minuten (vanaf startadres of vorige stop),
          // nooit de ranking-placeholder.
          reistijd_min:
            s.fromDurationSec != null
              ? Math.round(s.fromDurationSec / 60)
              : s.toDurationSec != null
                ? Math.round(s.toDurationSec / 60)
                : null,
          scoreSec: s.scoreSec,
          dayKey: s.dayKey,
          preferred,
          conversie,
          workload,
        });
      }
    }

    // Altijd kalender-uren toevoegen (10/13/16/19) zodat diversifyHours
    // niet alleen ochtend-FD-picks krijgt.
    if (diversifyHours || !scored || scored.length === 0) {
      const calCap = diversifyHours ? 40 : 8;
      const seenStart = new Set(
        candidates.filter((c) => c.adviseur_id === adv.id).map((c) => c.start_at)
      );
      for (const s of free.slice(0, calCap)) {
        if (seenStart.has(s.start_at)) continue;
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
          conversie_pct: convPct,
          reistijd_min: null,
          // Iets slechter dan route-score zodat FD blijft winnen als die er is
          scoreSec: scored && scored.length > 0 ? 50_000 : 0,
          dayKey,
          preferred,
          conversie,
          workload,
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

  /** Vergelijk: haalbaar → minder drukke agenda → reistijd → conversie. */
  function betterCandidate(a: Candidate, b: Candidate): number {
    return (
      Number(a.feasible) - Number(b.feasible) ||
      b.workload - a.workload ||
      b.scoreSec - a.scoreSec ||
      a.conversie - b.conversie ||
      Number(a.preferred) - Number(b.preferred) ||
      b.start_at.localeCompare(a.start_at)
    );
  }

  // Per wandklok-moment: adviseur met minste druk (dan route / conversie)
  const byMoment = new Map<string, Candidate>();
  for (const c of candidates) {
    const cur = byMoment.get(c.start_at);
    if (!cur || betterCandidate(c, cur) > 0) {
      byMoment.set(c.start_at, c);
    }
  }

  const ranked = [...byMoment.values()].sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (a.workload !== b.workload) return a.workload - b.workload;
    if (a.dayKey !== b.dayKey) return a.dayKey.localeCompare(b.dayKey);
    if (a.scoreSec !== b.scoreSec) return a.scoreSec - b.scoreSec;
    if (a.conversie !== b.conversie) return b.conversie - a.conversie;
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    return a.start_at.localeCompare(b.start_at);
  });

  let chosen: Candidate[];

  if (diversifyHours) {
    // Pool over ~2 weken → top 3: ochtend + middag + avond op 3 dagen
    // Prefer ook spreiding over adviseurs in de pool.
    const chronological = [...ranked].sort((a, b) => {
      if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
      if (a.workload !== b.workload) return a.workload - b.workload;
      return a.start_at.localeCompare(b.start_at);
    });
    const pool = chronological.slice(0, Math.max(poolSize, 40));
    chosen = pickFonioDaypartSlots(pool);
  } else {
    // Max 1 slot per dag + spreid over adviseurs (gelijke agenda-vulling)
    const onePerDay: Candidate[] = [];
    const seenDays = new Set<string>();
    const pickedPerAdv = new Map<string, number>();
    const maxPerAdv = Math.max(1, Math.ceil(limit / Math.max(adviseurs.length, 1)));

    const tryPick = (c: Candidate): boolean => {
      if (seenDays.has(c.dayKey)) return false;
      const n = pickedPerAdv.get(c.adviseur_id) || 0;
      if (n >= maxPerAdv && onePerDay.length + 1 < limit) {
        // Bewaar ruimte voor andere adviseurs zolang we nog moeten vullen
        const othersHaveRoom = adviseurs.some((a) => {
          if (a.id === c.adviseur_id) return false;
          return (pickedPerAdv.get(a.id) || 0) < maxPerAdv;
        });
        if (othersHaveRoom) return false;
      }
      seenDays.add(c.dayKey);
      pickedPerAdv.set(c.adviseur_id, n + 1);
      onePerDay.push(c);
      return true;
    };

    for (const c of ranked) {
      tryPick(c);
      if (onePerDay.length >= limit) break;
    }

    // Vul aan als spreiding te strikt was
    if (onePerDay.length < limit) {
      for (const c of ranked) {
        if (onePerDay.some((x) => x.slot_id === c.slot_id)) continue;
        if (!seenDays.has(c.dayKey)) seenDays.add(c.dayKey);
        else if (onePerDay.length >= Math.min(3, limit)) continue;
        onePerDay.push(c);
        if (onePerDay.length >= limit) break;
      }
    }
    chosen = onePerDay;
  }

  const slots: BestSlotOption[] = chosen.map(
    ({
      scoreSec: _s,
      dayKey: _d,
      preferred: _p,
      conversie: _c,
      workload: _w,
      ...rest
    }) => rest
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
      "Bied alleen label_nl aan. Boek met slot_id via POST /api/v1/afspraken (adviseur wordt automatisch gekoppeld). Ranking: gelijke agenda-vulling → reistijd → conversie.",
  };
}

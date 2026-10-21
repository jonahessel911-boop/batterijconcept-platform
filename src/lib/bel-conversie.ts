/**
 * Bel-conversie: leads afgeboekt of ingepland op een Amsterdam-dag, per beller → L→A %.
 */

import { addDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { isAdminEmail } from "@/lib/admin-adviseur";
import { AMSTERDAM_TZ } from "@/lib/format";
import { round2, safeDiv } from "@/lib/management-dashboard/periods";
import {
  PROVINCIE_ONBEKEND,
  provincieVanPostcode,
} from "@/lib/postcode-provincie";
import { normalizeRol } from "@/lib/rollen";
import { schouwWeekToMondayIso } from "@/lib/schouw-week";

export type BelConversieLead = {
  id: string;
  naam: string | null;
  lead_number: string | null;
  status: string | null;
  postcode?: string | null;
  bron?: string | null;
  utm_source?: string | null;
  lander?: string | null;
  campaign_name?: string | null;
  ad_name?: string | null;
  laatst_gebeld_at: string | null;
  laatst_gebeld_door?: string | null;
  bel_claimed_by?: string | null;
  beller_id?: string | null;
};

export type BelConversieAfspraak = {
  id: string;
  lead_id: string;
  created_at: string | null;
  start_at: string;
  status: string | null;
  soort: string | null;
  adviseur_id?: string | null;
  /** Wie de afspraak heeft ingepland (bel-credit) */
  ingepland_door_id?: string | null;
};

/** Huisbezoek dat op de gekozen dag is ingepland. */
export type BelConversieRecenteAfspraak = {
  id: string;
  leadId: string;
  leadNaam: string;
  leadNumber: string | null;
  bellerNaam: string | null;
  /** Provincie van de lead (via postcode), waar de afspraak gepland is */
  provincie: string | null;
  /** Adviseur voor wie het huisbezoek in de agenda staat */
  adviseurNaam: string | null;
  /** Moment waarop de afspraak is gezet (created_at) */
  ingeplandAt: string;
  /** Startdatum/-tijd van het huisbezoek */
  afspraakAt: string;
  /** Geannuleerd na inplannen — zichtbaar doorstreept, telt niet mee */
  geannuleerd?: boolean;
  bron?: string | null;
  utmSource?: string | null;
  lander?: string | null;
  campaignName?: string | null;
  adName?: string | null;
};

/** Cost per appointment over een rollend venster (ad spend ÷ huisbezoeken). */
export type BelConversieCpa = {
  days: 7 | 14 | 30;
  rangeStart: string;
  rangeEnd: string;
  adSpend: number;
  afsprakenGepland: number;
  /** null als geen afspraken in het venster */
  costPerAppointment: number | null;
};

export type BelConversieBellerRow = {
  bellerId: string | null;
  bellerNaam: string;
  gebeld: number;
  ingepland: number;
  leadToAppt: number | null;
  redenen: BelConversieRedenen;
};

/** Afboekredenen: status-key → aantal (alle voorkomende redenen). */
export type BelConversieRedenen = Record<string, number>;

function emptyRedenen(): BelConversieRedenen {
  return {};
}

function bumpReden(map: BelConversieRedenen, key: string) {
  const k = (key || "onbekend").toLowerCase();
  map[k] = (map[k] || 0) + 1;
}

export type BelConversieHorizonWeek = {
  jaar: number;
  week: number;
  label: string;
  slotsVrij: number;
  slotsGepland: number;
  slotsOpen: number;
};

/** Targets + voortgang: dagoel om deze week + 2 weken vooruit vol te plannen. */
export type BelConversieTargets = {
  /** Huisbezoeken gepland op de geselecteerde dag */
  geplandVandaag: number;
  /**
   * Dagoel = tempo om open slots over ~2 weken vooruit vol te plannen
   * (+ 20% uitval). Daalt alleen als er minder open slots overblijven.
   */
  doelVandaag: number;
  /** max(0, doel − gepland) */
  nogVandaag: number;
  /** 0–100 voortgang t.o.v. dagoel */
  pctVandaag: number;
  /** gepland ≥ doel */
  finishVandaag: boolean;
  /**
   * Weekdoel obv open slots (tempo om horizon vol te plannen × 5 werkdagen).
   * Tellers: huisbezoeken gezet deze ISO-week.
   */
  doelDezeWeek: number;
  /** Huisbezoeken ingepland in de huidige ISO-week */
  geplandDezeWeek: number;
  nogDezeWeek: number;
  pctDezeWeek: number;
  finishDezeWeek: boolean;
  /** Resterende bel-werkdagen vanaf focusdag t/m vrijdag (1–5) */
  resterendeWerkdagenWeek: number;
  /** Vrije slots over het venster (deze week + 2 weken vooruit) */
  horizonNog: number;
  horizonGepland: number;
  horizonOpen: number;
  horizonWeken: number;
  horizonWerkdagen: number;
  horizonLabel: string;
  /** Per week in het bel-horizon */
  horizonWeeks: BelConversieHorizonWeek[];
  /** L→A-doel % */
  leadToApptDoel: number;
  /**
   * Actuele overall L→A % (bijv. laatste 7 dagen).
   * Gebruikt om te schatten hoeveel afspraken er nog kúnnen.
   */
  leadToApptActueel: number | null;
  /**
   * Leads nog niet definitief afgeboekt (nieuw / geen_contact / …).
   * Geen contact telt wél mee — dat is geen definitieve afboeking.
   */
  leadsBelbaarTotaal: number;
  /** Daarvan: vandaag nog te bellen (nog geen belpoging vandaag) */
  leadsBelbaarVandaag: number;
  /** floor(leadsBelbaarTotaal × L→A) */
  afsprakenNogMogelijk: number;
  /** floor(leadsBelbaarVandaag × L→A) */
  afsprakenNogMogelijkVandaag: number;
};

export type BelConversieResult = {
  date: string;
  rangeStart: string;
  rangeEnd: string;
  /** Periode-label (bijv. Afgelopen 14 dagen) */
  periodLabel?: string;
  period?: string;
  periodDays?: number;
  totals: {
    gebeld: number;
    ingepland: number;
    leadToAppt: number | null;
    redenen: BelConversieRedenen;
  };
  targets: BelConversieTargets;
  byBeller: BelConversieBellerRow[];
  recenteAfspraken: BelConversieRecenteAfspraak[];
};

/** Werkdagen per week voor bel-dagoelen. */
export const BEL_WORKDAYS_PER_WEEK = 5;

/** Standaard horizon: deze week + 2 ISO-weken vooruit. */
export const BEL_TARGET_WEEKS_AHEAD = 3;

/**
 * Extra marge op dagoel (uitval / annuleringen).
 * 0.2 = 20% meer afspraken inplannen dan strikt nodig voor de vrije slots.
 */
export const BEL_TARGET_UITVAL_MARGE = 0.2;

/**
 * Dagoel huisbezoeken =
 * vrije slots over de horizon ÷ (weken × 5 werkdagen),
 * plus uitval-marge.
 */
export function dailyDoelFromVrijeSlots(
  slotsVrij: number,
  weeksAhead = BEL_TARGET_WEEKS_AHEAD,
  uitvalMarge = BEL_TARGET_UITVAL_MARGE
): { doel: number; werkdagen: number; doelBasis: number } {
  const weken = Math.max(1, Math.round(weeksAhead));
  const werkdagen = weken * BEL_WORKDAYS_PER_WEEK;
  const vrij = Math.max(0, Math.round(slotsVrij));
  if (vrij <= 0) return { doel: 0, werkdagen, doelBasis: 0 };
  const doelBasis = Math.ceil(vrij / werkdagen);
  const marge = Math.max(0, uitvalMarge);
  const doel = Math.ceil(doelBasis * (1 + marge));
  return { doel, werkdagen, doelBasis };
}

/** Aantal ma–vr tussen fromYmd en toYmd (inclusief), Amsterdam-kalender. */
export function countWeekdaysInclusive(
  fromYmd: string,
  toYmd: string
): number {
  if (!fromYmd || !toYmd || fromYmd > toYmd) return 0;
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  let cur = fromZonedTime(new Date(fy, fm - 1, fd, 12, 0, 0, 0), AMSTERDAM_TZ);
  const end = fromZonedTime(new Date(ty, tm - 1, td, 12, 0, 0, 0), AMSTERDAM_TZ);
  let n = 0;
  while (cur.getTime() <= end.getTime()) {
    const z = toZonedTime(cur, AMSTERDAM_TZ);
    const dow = z.getDay();
    if (dow >= 1 && dow <= 5) n += 1;
    cur = addDays(cur, 1);
  }
  return n;
}

function ymdFromAmsterdamDate(d: Date): string {
  const z = toZonedTime(d, AMSTERDAM_TZ);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, "0");
  const day = String(z.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function sundayYmdOfIsoWeek(jaar: number, week: number): string {
  const mondayRaw = schouwWeekToMondayIso(jaar, week);
  const mondayYmd = String(mondayRaw).slice(0, 10);
  const [y, m, d] = mondayYmd.split("-").map(Number);
  const sun = addDays(
    fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ),
    6
  );
  return ymdFromAmsterdamDate(sun);
}

/** Vrijdag (bel-werkweek) van de ISO-week die `ymd` bevat. */
export function fridayYmdOfIsoWeekContaining(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
  const z = toZonedTime(noon, AMSTERDAM_TZ);
  const dow = z.getDay(); // 0=zo … 6=za
  const toFriday = dow === 0 ? -2 : 5 - dow;
  return ymdFromAmsterdamDate(addDays(noon, toFriday));
}

/**
 * Dagoel zodat deze week + 2 weken vooruit vol komen (met 20% marge).
 * Per cumulatieve weekhorizon: ceil(vrij ÷ resterende werkdagen) × 1.2;
 * dagoel = max over die tempi.
 */
export function dailyDoelToFillAheadWeeks(opts: {
  weeks: { jaar: number; week: number; slotsVrij: number }[];
  fromYmd: string;
  uitvalMarge?: number;
}): { doel: number; werkdagen: number; doelBasis: number } {
  const marge = Math.max(0, opts.uitvalMarge ?? BEL_TARGET_UITVAL_MARGE);
  const weeks = opts.weeks.filter((w) => (w.slotsVrij || 0) > 0);
  if (weeks.length === 0) {
    return { doel: 0, werkdagen: 0, doelBasis: 0 };
  }

  let cumVrij = 0;
  let doel = 0;
  let doelBasis = 0;
  let werkdagen = 0;

  for (let i = 0; i < weeks.length; i++) {
    cumVrij += Math.max(0, Math.round(weeks[i]!.slotsVrij));
    const endYmd = sundayYmdOfIsoWeek(weeks[i]!.jaar, weeks[i]!.week);
    const days = countWeekdaysInclusive(opts.fromYmd, endYmd);
    if (days <= 0) continue;
    const basis = Math.ceil(cumVrij / days);
    const withMarge = Math.ceil(basis * (1 + marge));
    if (withMarge > doel) {
      doel = withMarge;
      doelBasis = basis;
      werkdagen = days;
    }
  }

  return { doel, werkdagen, doelBasis };
}

export function dailyAfsprakenDoelFromWeekly(
  weekly: number,
  uitvalMarge = BEL_TARGET_UITVAL_MARGE
): number {
  const w = Math.max(0, Number(weekly) || 0);
  if (w <= 0) return 0;
  const basis = Math.ceil(w / BEL_WORKDAYS_PER_WEEK);
  return Math.ceil(basis * (1 + Math.max(0, uitvalMarge)));
}

function amsDayBounds(ymd: string): { start: Date; end: Date } {
  const [y, m, d] = ymd.split("-").map(Number);
  const start = fromZonedTime(new Date(y, m - 1, d, 0, 0, 0, 0), AMSTERDAM_TZ);
  const end = fromZonedTime(
    new Date(y, m - 1, d, 23, 59, 59, 999),
    AMSTERDAM_TZ
  );
  return { start, end };
}

export function todayAmsterdamYmd(now = new Date()): string {
  const z = toZonedTime(now, AMSTERDAM_TZ);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, "0");
  const d = String(z.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function inAmsterdamDayRange(
  iso: string | null | undefined,
  start: Date,
  end: Date
): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/** Wie krijgt de credit voor deze afboeking. Sla admin-ids over (geen bel-credit). */
export function resolveBellerId(
  l: BelConversieLead,
  fallbackBellerId?: string | null,
  skipIds?: ReadonlySet<string> | string[] | null,
  /** Extra: wie de afspraak echt inplantte */
  ingeplandDoorId?: string | null
): string | null {
  const skip = new Set<string>();
  if (skipIds instanceof Set) {
    for (const id of skipIds) {
      const t = id?.trim();
      if (t) skip.add(t);
    }
  } else if (Array.isArray(skipIds)) {
    for (const id of skipIds) {
      const t = id?.trim();
      if (t) skip.add(t);
    }
  }
  // Wie echt inplantte wint; daarna lead-stamps; nooit silent solo-beller force.
  const candidates = [
    ingeplandDoorId,
    l.laatst_gebeld_door,
    l.bel_claimed_by,
    l.beller_id,
    fallbackBellerId,
  ];
  for (const raw of candidates) {
    const id = raw?.trim();
    if (!id || skip.has(id)) continue;
    return id;
  }
  return null;
}

/**
 * Echte fysieke nieuwe afspraak (soort `nieuw`).
 * Geen vervolg_fysiek, bel, warme_bel, warmtefonds of andere soorten.
 * Strict: alleen expliciet `nieuw` (geen fallback via normalize).
 */
export function isHuisbezoekSoort(a: BelConversieAfspraak): boolean {
  return (a.soort || "").trim() === "nieuw";
}

/** Actief huisbezoek (geen terugbel, niet geannuleerd) — telt mee voor L→A. */
export function isHuisbezoekAfspraak(a: BelConversieAfspraak): boolean {
  if (a.status === "geannuleerd") return false;
  return isHuisbezoekSoort(a);
}

/**
 * Eerste actieve (niet-geannuleerde) nieuwe huisbezoek per lead.
 * Bijklanten / 2e bezoek / vervolg tellen niet als bel-credit.
 */
export function eersteNieuweHuisbezoekIdPerLead(
  afspraken: BelConversieAfspraak[]
): Map<string, string> {
  const best = new Map<string, { id: string; at: number }>();
  for (const a of afspraken) {
    if (!isHuisbezoekAfspraak(a) || !a.created_at) continue;
    const at = new Date(a.created_at).getTime();
    if (!Number.isFinite(at)) continue;
    const prev = best.get(a.lead_id);
    if (!prev || at < prev.at) {
      best.set(a.lead_id, { id: a.id, at });
    }
  }
  const out = new Map<string, string>();
  for (const [leadId, v] of best) out.set(leadId, v.id);
  return out;
}

/**
 * true als dit het eerste nieuwe huisbezoek van de lead is.
 * Actief: exact de chronologisch eerste niet-geannuleerde.
 * Geannuleerd: alleen als er geen actief 1e is én dit de vroegste nieuw-rij is.
 */
export function isEersteNieuweHuisbezoek(
  a: BelConversieAfspraak,
  eersteActiefIds: Map<string, string>,
  historie: BelConversieAfspraak[] = []
): boolean {
  if (!isHuisbezoekSoort(a)) return false;
  const actiefId = eersteActiefIds.get(a.lead_id);
  if (a.status !== "geannuleerd") {
    return actiefId === a.id;
  }
  if (actiefId) return false;
  let earliestId: string | null = null;
  let earliestAt = Infinity;
  for (const x of historie) {
    if (x.lead_id !== a.lead_id || !isHuisbezoekSoort(x) || !x.created_at) {
      continue;
    }
    const at = new Date(x.created_at).getTime();
    if (!Number.isFinite(at)) continue;
    if (at < earliestAt) {
      earliestAt = at;
      earliestId = x.id;
    }
  }
  return earliestId === a.id;
}

/**
 * Huisbezoek gezet in het Amsterdam-venster.
 * Alleen created_at telt (ingepland) — niet start_at (dat is gelopen/bezoek).
 * Alleen het eerste nieuwe huisbezoek per lead (geen bijklant / 2e bezoek).
 */
export function huisbezoekLeadIdsOpDag(
  afspraken: BelConversieAfspraak[],
  start: Date,
  end: Date,
  /** Volledige historie (of minstens alle nieuw-afspraken van deze leads). */
  historieAfspraken?: BelConversieAfspraak[]
): Set<string> {
  const eersteIds = eersteNieuweHuisbezoekIdPerLead(
    historieAfspraken ?? afspraken
  );
  const ids = new Set<string>();
  for (const a of afspraken) {
    if (!isHuisbezoekAfspraak(a)) continue;
    if (!a.created_at) continue;
    if (!inAmsterdamDayRange(a.created_at, start, end)) continue;
    if (eersteIds.get(a.lead_id) !== a.id) continue;
    ids.add(a.lead_id);
  }
  return ids;
}

/** Nog niet gelopen: start_at in de toekomst (of nu). */
export function isAfspraakNogNietGelopen(
  a: Pick<BelConversieAfspraak, "start_at">,
  now = new Date()
): boolean {
  const t = new Date(a.start_at).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= now.getTime();
}

export function buildBelConversieTargets(opts: {
  geplandVandaag: number;
  /** Huisbezoeken ingepland in de huidige ISO-week (ma–zo). */
  geplandDezeWeek?: number;
  leadToApptDoel: number;
  /** Capaciteit deze week + N−1 weken vooruit (vrije slots = nog te plannen). */
  horizon: {
    weeksAhead: number;
    slotsVrij: number;
    slotsGepland: number;
    slotsOpen: number;
    label?: string;
    weeks?: BelConversieHorizonWeek[];
  } | null;
  /** Vanaf welke dag het bel-tempo rekenen (meestal vandaag / gekozen datum). */
  fromYmd?: string;
  /** Fallback als er geen capaciteit is: weekdoel ÷ 5. */
  weeklyAfsprakenDoelFallback?: number;
  /** Actuele L→A als % (niet fractie). */
  leadToApptActueel?: number | null;
  leadsBelbaarTotaal?: number;
  leadsBelbaarVandaag?: number;
}): BelConversieTargets {
  const gepland = Math.max(0, Math.round(opts.geplandVandaag));
  const h = opts.horizon;
  const weeksAhead = h?.weeksAhead ?? BEL_TARGET_WEEKS_AHEAD;
  const slotsVrij = h?.slotsVrij ?? 0;
  const horizonWeeks = h?.weeks ?? [];
  const fromYmd = opts.fromYmd || todayAmsterdamYmd();

  // Slot-tempo (open slots horizon ÷ werkdagen + 20% uitval)
  let tempoDoel: number;
  let werkdagen: number;
  if (horizonWeeks.length > 0 && slotsVrij > 0) {
    const d = dailyDoelToFillAheadWeeks({
      weeks: horizonWeeks,
      fromYmd,
    });
    tempoDoel = d.doel;
    werkdagen = d.werkdagen;
  } else if (slotsVrij > 0) {
    const d = dailyDoelFromVrijeSlots(slotsVrij, weeksAhead);
    tempoDoel = d.doel;
    werkdagen = d.werkdagen;
  } else {
    tempoDoel = dailyAfsprakenDoelFromWeekly(
      opts.weeklyAfsprakenDoelFallback ?? 0
    );
    werkdagen = weeksAhead * BEL_WORKDAYS_PER_WEEK;
  }

  // Weekdoel: slot-tempo × 5 bel-werkdagen (volume om weekfinish te halen)
  const doelDezeWeek =
    tempoDoel > 0 ? tempoDoel * BEL_WORKDAYS_PER_WEEK : 0;
  const geplandDezeWeek = Math.max(
    0,
    Math.round(opts.geplandDezeWeek ?? gepland)
  );
  const nogDezeWeek = Math.max(0, doelDezeWeek - geplandDezeWeek);
  const pctDezeWeek =
    doelDezeWeek > 0
      ? Math.min(100, Math.round((geplandDezeWeek / doelDezeWeek) * 100))
      : geplandDezeWeek > 0
        ? 100
        : 0;

  // Dagoel = slot-tempo (2 weken vooruit), niet restant-week ÷ resterende dagen.
  // Plannen vandaag: teller omhoog; noemer blijft tot open slots echt dalen.
  const fridayYmd = fridayYmdOfIsoWeekContaining(fromYmd);
  const resterendeWerkdagenWeek = Math.max(
    0,
    countWeekdaysInclusive(fromYmd, fridayYmd)
  );
  const doelVandaag = tempoDoel;
  const nogVandaag = Math.max(0, doelVandaag - gepland);
  const pctVandaag =
    doelVandaag > 0
      ? Math.min(100, Math.round((gepland / doelVandaag) * 100))
      : gepland > 0
        ? 100
        : 0;

  const l2aActueel =
    opts.leadToApptActueel != null && Number.isFinite(opts.leadToApptActueel)
      ? Math.round(opts.leadToApptActueel * 10) / 10
      : null;
  const belbaarTotaal = Math.max(0, Math.round(opts.leadsBelbaarTotaal ?? 0));
  const belbaarVandaag = Math.max(
    0,
    Math.round(opts.leadsBelbaarVandaag ?? 0)
  );
  const l2aFrac = l2aActueel != null && l2aActueel > 0 ? l2aActueel / 100 : 0;
  const afsprakenNogMogelijk =
    l2aFrac > 0 ? Math.floor(belbaarTotaal * l2aFrac) : 0;
  const afsprakenNogMogelijkVandaag =
    l2aFrac > 0 ? Math.floor(belbaarVandaag * l2aFrac) : 0;

  return {
    geplandVandaag: gepland,
    doelVandaag,
    nogVandaag,
    pctVandaag,
    finishVandaag: doelVandaag > 0 ? gepland >= doelVandaag : false,
    doelDezeWeek,
    geplandDezeWeek,
    nogDezeWeek,
    pctDezeWeek,
    finishDezeWeek: doelDezeWeek > 0 ? geplandDezeWeek >= doelDezeWeek : false,
    resterendeWerkdagenWeek,
    horizonNog: slotsVrij,
    horizonGepland: h?.slotsGepland ?? 0,
    horizonOpen: h?.slotsOpen ?? 0,
    horizonWeken: weeksAhead,
    horizonWerkdagen: werkdagen,
    horizonLabel:
      h?.label ||
      `Deze week + 2 weken · ${werkdagen} bel-werkdagen`,
    horizonWeeks,
    leadToApptDoel: Math.round(opts.leadToApptDoel * 10) / 10,
    leadToApptActueel: l2aActueel,
    leadsBelbaarTotaal: belbaarTotaal,
    leadsBelbaarVandaag: belbaarVandaag,
    afsprakenNogMogelijk,
    afsprakenNogMogelijkVandaag,
  };
}

export function buildBelConversie(opts: {
  dateYmd: string;
  /** Inclusief startdatum van het rapportagevenster (default = dateYmd). */
  rangeStartYmd?: string;
  periodLabel?: string;
  period?: string;
  periodDays?: number;
  leads: BelConversieLead[];
  afspraken: BelConversieAfspraak[];
  /**
   * Alle nieuw-huisbezoeken van deze leads (ook buiten de periode).
   * Nodig om 2e bezoek / bijklant uit te sluiten.
   */
  huisbezoekHistorie?: BelConversieAfspraak[];
  adviseurs: {
    id: string;
    naam: string;
    rol?: string | null;
    actief?: boolean;
    email?: string | null;
  }[];
  /** Als laatst_gebeld_door ontbreekt: credit aan deze medewerker. */
  fallbackBellerId?: string | null;
  targets?: BelConversieTargets;
  /**
   * Voortgang dagoel/weekdoel (operationeel vanaf vandaag).
   * Los van het rapportagevenster, zodat multi-day filters de finishlijn niet kapot maken.
   */
  geplandVandaagForTargets?: number;
  geplandDezeWeekForTargets?: number;
}): BelConversieResult {
  const rangeStartYmd = opts.rangeStartYmd || opts.dateYmd;
  const { start } = amsDayBounds(rangeStartYmd);
  const { end } = amsDayBounds(opts.dateYmd);
  const historie = opts.huisbezoekHistorie ?? opts.afspraken;
  const eersteIds = eersteNieuweHuisbezoekIdPerLead(historie);
  const ingeplandIds = huisbezoekLeadIdsOpDag(
    opts.afspraken,
    start,
    end,
    historie
  );

  // Admin krijgt geen bel-credit (sessie-stamp tijdens meekijken/inplannen).
  const skipAdminIds = new Set<string>();
  const activeBellerIds: string[] = [];
  for (const a of opts.adviseurs) {
    const rol = normalizeRol(a.rol);
    if (rol === "admin" || isAdminEmail(a.email)) {
      skipAdminIds.add(a.id);
      continue;
    }
    if (a.actief !== false && rol === "beller") {
      activeBellerIds.push(a.id);
    }
  }
  // Alleen als er precies één actieve beller is: orphans → die persoon.
  const soloBellerId =
    activeBellerIds.length === 1 ? activeBellerIds[0] : null;
  const orphanFallback =
    opts.fallbackBellerId?.trim() || soloBellerId || null;

  // Gebeld = afgeboekt die dag, of huisbezoek gezet die dag (bel-inplanning)
  const byId = new Map<string, BelConversieLead>();
  for (const l of opts.leads) {
    const gebeldDag = inAmsterdamDayRange(l.laatst_gebeld_at, start, end);
    const ingeplandDag = ingeplandIds.has(l.id);
    if (!gebeldDag && !ingeplandDag) continue;
    byId.set(l.id, l);
  }

  // Wie plantte het huisbezoek in (ingepland_door_id), nieuwste per lead
  const ingeplandDoorByLead = new Map<string, string>();
  for (const a of opts.afspraken) {
    if (!isHuisbezoekAfspraak(a)) continue;
    if (eersteIds.get(a.lead_id) !== a.id) continue;
    const door = (a.ingepland_door_id || "").trim();
    if (!door || !a.created_at) continue;
    if (!inAmsterdamDayRange(a.created_at, start, end)) continue;
    if (!ingeplandDoorByLead.has(a.lead_id)) {
      ingeplandDoorByLead.set(a.lead_id, door);
    }
  }

  type Acc = {
    gebeld: number;
    ingepland: number;
    redenen: BelConversieRedenen;
  };
  const by = new Map<string, Acc>();
  const touch = (key: string): Acc => {
    let a = by.get(key);
    if (!a) {
      a = { gebeld: 0, ingepland: 0, redenen: emptyRedenen() };
      by.set(key, a);
    }
    return a;
  };

  let ingeplandTotal = 0;
  const redenenTotal = emptyRedenen();
  for (const l of byId.values()) {
    const isIngepland = ingeplandIds.has(l.id);
    // Ingepland → planner; anders lead-stamps / claim / solo-beller.
    // Nooit stilzwijgend "Onbekend" als we wél één actieve beller hebben.
    const id =
      (isIngepland
        ? ingeplandDoorByLead.get(l.id)?.trim() ||
          resolveBellerId(l, orphanFallback, skipAdminIds, null)
        : resolveBellerId(l, orphanFallback, skipAdminIds, null)) ||
      "__onbekend__";
    const acc = touch(id);
    acc.gebeld += 1;
    if (isIngepland) {
      acc.ingepland += 1;
      ingeplandTotal += 1;
      bumpReden(acc.redenen, "afspraak_ingepland");
      bumpReden(redenenTotal, "afspraak_ingepland");
    } else {
      bumpReden(acc.redenen, l.status || "onbekend");
      bumpReden(redenenTotal, l.status || "onbekend");
    }
  }

  const naamById = new Map(
    opts.adviseurs.map((a) => [a.id, a.naam] as const)
  );

  // Ranking-rijen: beller/backoffice + adviseurs die zelf gebeld/ingepland hebben
  for (const a of opts.adviseurs) {
    if (!a.actief) continue;
    if (skipAdminIds.has(a.id)) continue;
    const rol = normalizeRol(a.rol);
    const isCaller = rol === "beller" || rol === "backoffice";
    if (!isCaller && !by.has(a.id)) continue;
    if (!by.has(a.id)) {
      by.set(a.id, { gebeld: 0, ingepland: 0, redenen: emptyRedenen() });
    }
  }

  const byBeller: BelConversieBellerRow[] = [...by.entries()]
    .map(([id, acc]) => {
      const l2a = safeDiv(acc.ingepland, acc.gebeld);
      return {
        bellerId: id === "__onbekend__" ? null : id,
        bellerNaam:
          id === "__onbekend__"
            ? "Onbekend"
            : naamById.get(id) || "Onbekende medewerker",
        gebeld: acc.gebeld,
        ingepland: acc.ingepland,
        leadToAppt: l2a != null ? round2(l2a * 100) : null,
        redenen: acc.redenen,
      };
    })
    .filter((r) => r.gebeld > 0 || r.bellerId != null)
    .sort(
      (a, b) =>
        b.gebeld - a.gebeld ||
        b.ingepland - a.ingepland ||
        a.bellerNaam.localeCompare(b.bellerNaam, "nl")
    );

  const gebeld = byId.size;
  const l2a = safeDiv(ingeplandTotal, gebeld);
  const leadToAppt = l2a != null ? round2(l2a * 100) : null;
  const redenen = redenenTotal;

  const baseTargets =
    opts.targets ||
    buildBelConversieTargets({
      geplandVandaag: ingeplandTotal,
      leadToApptDoel: 25,
      horizon: null,
    });

  const targets = buildBelConversieTargets({
    geplandVandaag:
      opts.geplandVandaagForTargets != null
        ? opts.geplandVandaagForTargets
        : ingeplandTotal,
    geplandDezeWeek:
      opts.geplandDezeWeekForTargets != null
        ? opts.geplandDezeWeekForTargets
        : baseTargets.geplandDezeWeek,
    leadToApptDoel: baseTargets.leadToApptDoel,
    fromYmd: opts.dateYmd,
    horizon: {
      weeksAhead: baseTargets.horizonWeken,
      slotsVrij: baseTargets.horizonNog,
      slotsGepland: baseTargets.horizonGepland,
      slotsOpen: baseTargets.horizonOpen,
      label: baseTargets.horizonLabel,
      weeks: baseTargets.horizonWeeks,
    },
    weeklyAfsprakenDoelFallback: baseTargets.doelDezeWeek,
    leadToApptActueel: baseTargets.leadToApptActueel,
    leadsBelbaarTotaal: baseTargets.leadsBelbaarTotaal,
    leadsBelbaarVandaag: baseTargets.leadsBelbaarVandaag,
  });

  // Ingeplande nieuwe huisbezoeken (created_at in periode): alleen 1e per lead.
  // Actief + nog niet gelopen, én geannuleerde (doorstreept; tellen niet in totals).
  const now = new Date();
  const recenteAfspraken: BelConversieRecenteAfspraak[] = [];
  for (const a of opts.afspraken) {
    if (!isHuisbezoekSoort(a)) continue;
    if (!a.created_at) continue;
    if (!inAmsterdamDayRange(a.created_at, start, end)) continue;
    if (!isEersteNieuweHuisbezoek(a, eersteIds, historie)) continue;
    const geannuleerd = a.status === "geannuleerd";
    if (!geannuleerd && !isAfspraakNogNietGelopen(a, now)) continue;
    const lead =
      byId.get(a.lead_id) || opts.leads.find((l) => l.id === a.lead_id);
    // Alleen echte planner (ingepland_door). Geen Tarik/claim-fallback op oude rijen.
    const doorRaw =
      (a.ingepland_door_id || "").trim() ||
      ingeplandDoorByLead.get(a.lead_id) ||
      "";
    const bellerId = doorRaw || null;
    const adviseurId = (a.adviseur_id || "").trim() || null;
    const provincieRaw = provincieVanPostcode(lead?.postcode);
    recenteAfspraken.push({
      id: a.id,
      leadId: a.lead_id,
      leadNaam: lead?.naam?.trim() || "Onbekende lead",
      leadNumber: lead?.lead_number ?? null,
      bellerNaam: bellerId ? naamById.get(bellerId) || null : null,
      provincie:
        provincieRaw && provincieRaw !== PROVINCIE_ONBEKEND
          ? provincieRaw
          : null,
      adviseurNaam: adviseurId ? naamById.get(adviseurId) || null : null,
      ingeplandAt: a.created_at,
      afspraakAt: a.start_at,
      geannuleerd,
      bron: lead?.bron ?? null,
      utmSource: lead?.utm_source ?? null,
      lander: lead?.lander ?? null,
      campaignName: lead?.campaign_name ?? null,
      adName: lead?.ad_name ?? null,
    });
  }
  recenteAfspraken.sort(
    (a, b) =>
      Number(a.geannuleerd) - Number(b.geannuleerd) ||
      new Date(b.ingeplandAt).getTime() - new Date(a.ingeplandAt).getTime()
  );

  return {
    date: opts.dateYmd,
    rangeStart: start.toISOString(),
    rangeEnd: end.toISOString(),
    periodLabel: opts.periodLabel,
    period: opts.period,
    periodDays: opts.periodDays,
    totals: {
      gebeld,
      ingepland: ingeplandTotal,
      leadToAppt,
      redenen,
    },
    targets,
    byBeller,
    recenteAfspraken,
  };
}

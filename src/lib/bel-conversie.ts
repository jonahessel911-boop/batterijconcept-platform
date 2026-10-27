/**
 * Bel-conversie: leads afgeboekt of ingepland op een Amsterdam-dag, per beller → L→A %.
 */

import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { isAdminEmail } from "@/lib/admin-adviseur";
import { AMSTERDAM_TZ } from "@/lib/format";
import { isGeenInteresseStatus } from "@/lib/labels";
import { round2, safeDiv } from "@/lib/management-dashboard/periods";
import {
  PROVINCIE_ONBEKEND,
  provincieVanPostcode,
} from "@/lib/postcode-provincie";
import { normalizeRol } from "@/lib/rollen";
import { schouwWeekFromDate, schouwWeekToMondayIso } from "@/lib/schouw-week";

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
  geannuleerd: number;
  annuleringsPct: number | null;
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

/** Targets + voortgang: tempo om horizon (deze week + 2 weken) vol te plannen. */
export type BelConversieTargets = {
  /** Huisbezoeken gepland op de geselecteerde dag */
  geplandVandaag: number;
  /**
   * Dagoel = tempo om vrije slots over de horizon vol te plannen (+ uitval),
   * eventueel hoger bij inhaal t.o.v. weekdoel.
   */
  doelVandaag: number;
  /** max(0, doel − gepland) */
  nogVandaag: number;
  /** 0–100 voortgang t.o.v. dagoel */
  pctVandaag: number;
  /** gepland ≥ doel */
  finishVandaag: boolean;
  /**
   * Weekdoel = dagoel × 5 bel-werkdagen (weektempo om 2 weken vol te krijgen).
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
    geannuleerd: number;
    annuleringsPct: number | null;
    leadToAppt: number | null;
    redenen: BelConversieRedenen;
    /**
     * Alleen leads die niet meer status “nieuw” hebben (afgeboekt / in funnel).
     * L→A = huisbezoeken ÷ die leads.
     */
    nonNieuwGebeld: number;
    nonNieuwIngepland: number;
    nonNieuwLeadToAppt: number | null;
  };
  targets: BelConversieTargets;
  byBeller: BelConversieBellerRow[];
  recenteAfspraken: BelConversieRecenteAfspraak[];
  /** Tijdreeks voor staafgrafiek (dag of week) */
  series?: BelConversieSeriesBucket[];
  seriesGranularity?: BelConversieSeriesGranularity;
};

/** Granulariteit van de bel-tijdreeks. */
export type BelConversieSeriesGranularity = "day" | "week";

/** Eén staaf in de bel-conversie-grafiek. */
export type BelConversieSeriesBucket = {
  key: string;
  label: string;
  startYmd: string;
  endYmd: string;
  /** Nieuwe huisbezoeken ingepland in dit venster */
  ingepland: number;
  /** Totaal gebeld (ingepland + terugbel/uitkomsten) */
  gebeld: number;
  geenInteresse: number;
  geenContact: number;
  /** Geannuleerde nieuw-huisbezoeken gezet in dit venster */
  geannuleerd: number;
  /** Uitval % = geannuleerd ÷ (ingepland + geannuleerd) */
  annuleringsPct: number | null;
  /** L→A alleen op leads met status ≠ nieuw */
  nonNieuwGebeld: number;
  nonNieuwIngepland: number;
  leadToAppt: number | null;
  /** Ingepland-doel voor dit venster (0 in weekend bij dagreeks) */
  doel: number;
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

/** Ma–vr op Amsterdam-kalender. */
export function isAmsterdamWeekday(ymd: string): boolean {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const z = toZonedTime(
    fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ),
    AMSTERDAM_TZ
  );
  const dow = z.getDay();
  return dow >= 1 && dow <= 5;
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

/**
 * Weekdoel → dagoel met inhaal.
 * Restant (weekdoel − al gepland) ÷ resterende bel-werkdagen t/m vrijdag.
 * Achterstand op eerdere dagen → hoger dagoel; voorliggend → lager.
 */
export function dailyDoelFromWeekCatchUp(opts: {
  weekDoel: number;
  geplandDezeWeek: number;
  fromYmd: string;
}): {
  doelVandaag: number;
  nogDezeWeek: number;
  resterendeWerkdagen: number;
} {
  const weekDoel = Math.max(0, Math.round(opts.weekDoel));
  const gepland = Math.max(0, Math.round(opts.geplandDezeWeek));
  const nogDezeWeek = Math.max(0, weekDoel - gepland);
  const fridayYmd = fridayYmdOfIsoWeekContaining(opts.fromYmd);
  const resterendeWerkdagen = Math.max(
    0,
    countWeekdaysInclusive(opts.fromYmd, fridayYmd)
  );
  if (nogDezeWeek <= 0) {
    return { doelVandaag: 0, nogDezeWeek: 0, resterendeWerkdagen };
  }
  if (resterendeWerkdagen <= 0) {
    // Weekend / na vrijdag: restant alsnog als “vandaag” tonen
    return {
      doelVandaag: nogDezeWeek,
      nogDezeWeek,
      resterendeWerkdagen: 0,
    };
  }
  return {
    doelVandaag: Math.ceil(nogDezeWeek / resterendeWerkdagen),
    nogDezeWeek,
    resterendeWerkdagen,
  };
}

/** Open slots van de ISO-week die `ymd` bevat (uit capacity-horizon). */
export function slotsOpenForIsoWeekContaining(
  weeks: BelConversieHorizonWeek[] | null | undefined,
  ymd: string
): number | null {
  if (!weeks?.length || !ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
  const info = schouwWeekFromDate(noon);
  const hit = weeks.find((w) => w.jaar === info.jaar && w.week === info.week);
  if (!hit) return null;
  return Math.max(0, Math.round(hit.slotsOpen || 0));
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
  /** Capaciteit deze week + N−1 weken vooruit. */
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
  /** Fallback weekdoel als er geen open-slots voor deze week zijn. */
  weeklyAfsprakenDoelFallback?: number;
  /** Uitval/annuleringen-marge op weekdoel (default 20%). */
  uitvalMarge?: number;
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
  const uitvalMarge = Math.max(
    0,
    opts.uitvalMarge ?? BEL_TARGET_UITVAL_MARGE
  );
  const geplandDezeWeek = Math.max(
    0,
    Math.round(opts.geplandDezeWeek ?? gepland)
  );

  // Tempo = vrije slots over horizon (deze week + 2 weken) vol + uitvalmarge.
  // Niet alleen “open slots deze week” — anders blijft week 45/46 leeg.
  const fill =
    horizonWeeks.length > 0 && slotsVrij > 0
      ? dailyDoelToFillAheadWeeks({
          weeks: horizonWeeks,
          fromYmd,
          uitvalMarge,
        })
      : slotsVrij > 0
        ? dailyDoelFromVrijeSlots(slotsVrij, weeksAhead, uitvalMarge)
        : { doel: 0, werkdagen: 0, doelBasis: 0 };

  let doelVandaagBasis = fill.doel;
  if (
    doelVandaagBasis <= 0 &&
    (opts.weeklyAfsprakenDoelFallback ?? 0) > 0
  ) {
    doelVandaagBasis = dailyAfsprakenDoelFromWeekly(
      opts.weeklyAfsprakenDoelFallback ?? 0,
      uitvalMarge
    );
  }

  const doelDezeWeek = doelVandaagBasis * BEL_WORKDAYS_PER_WEEK;

  const catchUp = dailyDoelFromWeekCatchUp({
    weekDoel: doelDezeWeek,
    geplandDezeWeek,
    fromYmd,
  });
  // Nooit onder fill-ahead-tempo; wel hoger bij week-achterstand
  const doelVandaag = Math.max(doelVandaagBasis, catchUp.doelVandaag);
  const nogDezeWeek = catchUp.nogDezeWeek;
  const resterendeWerkdagenWeek = catchUp.resterendeWerkdagen;
  const pctDezeWeek =
    doelDezeWeek > 0
      ? Math.min(100, Math.round((geplandDezeWeek / doelDezeWeek) * 100))
      : geplandDezeWeek > 0
        ? 100
        : 0;

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

  const werkdagen =
    resterendeWerkdagenWeek > 0
      ? resterendeWerkdagenWeek
      : BEL_WORKDAYS_PER_WEEK;

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
      `Tempo 2 weken vol (+${Math.round(uitvalMarge * 100)}% uitval) · ${slotsVrij} vrij`,
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
  /** Alleen leads toegeschreven aan deze beller (totals + byBeller + recente). */
  bellerId?: string | null;
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

  // Alleen beller/backoffice krijgen bel-credit; adviseurs/admin niet.
  const allowedCallerIds = new Set<string>();
  const skipNonCallerIds = new Set<string>();
  const activeBellerIds: string[] = [];
  for (const a of opts.adviseurs) {
    const rol = normalizeRol(a.rol);
    if (rol === "admin" || isAdminEmail(a.email)) {
      skipNonCallerIds.add(a.id);
      continue;
    }
    if (rol === "beller" || rol === "backoffice") {
      allowedCallerIds.add(a.id);
      if (a.actief !== false && rol === "beller") {
        activeBellerIds.push(a.id);
      }
    } else {
      skipNonCallerIds.add(a.id);
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
    geannuleerd: number;
    redenen: BelConversieRedenen;
  };
  const by = new Map<string, Acc>();
  const touch = (key: string): Acc => {
    let a = by.get(key);
    if (!a) {
      a = { gebeld: 0, ingepland: 0, geannuleerd: 0, redenen: emptyRedenen() };
      by.set(key, a);
    }
    return a;
  };

  const filterBeller = opts.bellerId?.trim() || null;

  let ingeplandTotal = 0;
  let geannuleerdTotal = 0;
  const redenenTotal = emptyRedenen();
  for (const l of byId.values()) {
    const isIngepland = ingeplandIds.has(l.id);
    // Ingepland → planner; anders lead-stamps / claim / solo-beller.
    // Nooit stilzwijgend "Onbekend" als we wél één actieve beller hebben.
    const id =
      attributedBellerIdForLead({
        lead: l,
        isIngepland,
        ingeplandDoorId: ingeplandDoorByLead.get(l.id),
        fallbackBellerId: orphanFallback,
        skipAdminIds: skipNonCallerIds,
      }) || "__onbekend__";
    if (filterBeller && id !== filterBeller) continue;
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

  // Uitval per beller: geannuleerde nieuw-afspraken die zij inzette
  for (const a of opts.afspraken) {
    if (!isHuisbezoekSoort(a)) continue;
    if (a.status !== "geannuleerd") continue;
    if (!a.created_at) continue;
    if (!inAmsterdamDayRange(a.created_at, start, end)) continue;
    const door = (a.ingepland_door_id || "").trim();
    let id = door || "";
    if (!id || skipNonCallerIds.has(id)) {
      id = orphanFallback || "__onbekend__";
    }
    if (!allowedCallerIds.has(id) && id !== "__onbekend__") {
      id = orphanFallback || "__onbekend__";
    }
    if (filterBeller && id !== filterBeller) continue;
    const acc = touch(id);
    acc.geannuleerd += 1;
    geannuleerdTotal += 1;
    bumpReden(acc.redenen, "geannuleerd");
    bumpReden(redenenTotal, "geannuleerd");
  }

  // Filter byId na attribution — nonNieuw-tellers / size moeten matchen
  if (filterBeller) {
    for (const [leadId, l] of [...byId.entries()]) {
      const isIngepland = ingeplandIds.has(leadId);
      const id =
        attributedBellerIdForLead({
          lead: l,
          isIngepland,
          ingeplandDoorId: ingeplandDoorByLead.get(leadId),
          fallbackBellerId: orphanFallback,
          skipAdminIds: skipNonCallerIds,
        }) || "__onbekend__";
      if (id !== filterBeller) byId.delete(leadId);
    }
  }

  const naamById = new Map(
    opts.adviseurs.map((a) => [a.id, a.naam] as const)
  );

  // Ranking-rijen: alleen beller/backoffice (+ Onbekend via activity)
  if (!filterBeller) {
    for (const id of allowedCallerIds) {
      const a = opts.adviseurs.find((x) => x.id === id);
      if (!a || a.actief === false) continue;
      if (!by.has(id)) {
        by.set(id, {
          gebeld: 0,
          ingepland: 0,
          geannuleerd: 0,
          redenen: emptyRedenen(),
        });
      }
    }
  }

  const byBeller: BelConversieBellerRow[] = [...by.entries()]
    .filter(
      ([id]) => id === "__onbekend__" || allowedCallerIds.has(id)
    )
    .map(([id, acc]) => {
      const l2a = safeDiv(acc.ingepland, acc.gebeld);
      const uitval = safeDiv(acc.geannuleerd, acc.ingepland + acc.geannuleerd);
      return {
        bellerId: id === "__onbekend__" ? null : id,
        bellerNaam:
          id === "__onbekend__"
            ? "Onbekend"
            : naamById.get(id) || "Onbekende medewerker",
        gebeld: acc.gebeld,
        ingepland: acc.ingepland,
        geannuleerd: acc.geannuleerd,
        annuleringsPct: uitval != null ? round2(uitval * 100) : null,
        leadToAppt: l2a != null ? round2(l2a * 100) : null,
        redenen: acc.redenen,
      };
    })
    .filter((r) => {
      if (filterBeller) return r.bellerId === filterBeller;
      return r.gebeld > 0 || r.geannuleerd > 0 || r.bellerId != null;
    })
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

  // L→A voor leads die niet (meer) “nieuw” zijn — outcome/werk in de funnel
  let nonNieuwGebeld = 0;
  let nonNieuwIngepland = 0;
  for (const l of byId.values()) {
    const status = (l.status || "").trim().toLowerCase();
    if (status === "nieuw" || status === "") continue;
    nonNieuwGebeld += 1;
    if (ingeplandIds.has(l.id)) nonNieuwIngepland += 1;
  }
  const nonNieuwL2a = safeDiv(nonNieuwIngepland, nonNieuwGebeld);
  const nonNieuwLeadToAppt =
    nonNieuwL2a != null ? round2(nonNieuwL2a * 100) : null;

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
    if (filterBeller && bellerId !== filterBeller) continue;
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
      geannuleerd: geannuleerdTotal,
      annuleringsPct: (() => {
        const u = safeDiv(geannuleerdTotal, ingeplandTotal + geannuleerdTotal);
        return u != null ? round2(u * 100) : null;
      })(),
      leadToAppt,
      redenen,
      nonNieuwGebeld,
      nonNieuwIngepland,
      nonNieuwLeadToAppt,
    },
    targets,
    byBeller,
    recenteAfspraken,
  };
}

function noonAmsterdamFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
}

function shiftAmsterdamYmdLocal(ymd: string, deltaDays: number): string {
  return ymdFromAmsterdamDate(addDays(noonAmsterdamFromYmd(ymd), deltaDays));
}

function isGeenContactStatus(status: string | null | undefined): boolean {
  const s = (status || "").trim().toLowerCase();
  return s === "geen_contact" || s === "vervolg_geen_contact";
}

/**
 * Credit-beller voor een lead in een venster (zelfde regels als ranking).
 */
export function attributedBellerIdForLead(opts: {
  lead: BelConversieLead;
  isIngepland: boolean;
  ingeplandDoorId?: string | null;
  fallbackBellerId?: string | null;
  skipAdminIds?: ReadonlySet<string> | null;
}): string | null {
  if (opts.isIngepland) {
    return (
      opts.ingeplandDoorId?.trim() ||
      resolveBellerId(
        opts.lead,
        opts.fallbackBellerId,
        opts.skipAdminIds,
        null
      )
    );
  }
  return resolveBellerId(
    opts.lead,
    opts.fallbackBellerId,
    opts.skipAdminIds,
    null
  );
}

/** Metrics voor één Amsterdam-venster (zelfde tellingen als totals). */
export function scoreBelConversieWindow(opts: {
  startYmd: string;
  endYmd: string;
  leads: BelConversieLead[];
  afspraken: BelConversieAfspraak[];
  huisbezoekHistorie?: BelConversieAfspraak[];
  /** Alleen leads toegeschreven aan deze beller */
  bellerId?: string | null;
  fallbackBellerId?: string | null;
  skipAdminIds?: ReadonlySet<string> | null;
}): Omit<
  BelConversieSeriesBucket,
  "key" | "label" | "startYmd" | "endYmd"
> {
  const { start } = amsDayBounds(opts.startYmd);
  const { end } = amsDayBounds(opts.endYmd);
  const historie = opts.huisbezoekHistorie ?? opts.afspraken;
  const eersteIds = eersteNieuweHuisbezoekIdPerLead(historie);
  const ingeplandIds = huisbezoekLeadIdsOpDag(
    opts.afspraken,
    start,
    end,
    historie
  );

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

  const filterBeller = opts.bellerId?.trim() || null;

  const byId = new Map<string, BelConversieLead>();
  for (const l of opts.leads) {
    const gebeldDag = inAmsterdamDayRange(l.laatst_gebeld_at, start, end);
    const ingeplandDag = ingeplandIds.has(l.id);
    if (!gebeldDag && !ingeplandDag) continue;
    if (filterBeller) {
      const attributed = attributedBellerIdForLead({
        lead: l,
        isIngepland: ingeplandDag,
        ingeplandDoorId: ingeplandDoorByLead.get(l.id),
        fallbackBellerId: opts.fallbackBellerId,
        skipAdminIds: opts.skipAdminIds,
      });
      if (attributed !== filterBeller) continue;
    }
    byId.set(l.id, l);
  }

  let ingepland = 0;
  let geenInteresse = 0;
  let geenContact = 0;
  let nonNieuwGebeld = 0;
  let nonNieuwIngepland = 0;

  for (const l of byId.values()) {
    const isIngepland = ingeplandIds.has(l.id);
    if (isIngepland) {
      ingepland += 1;
    } else if (isGeenInteresseStatus(l.status)) {
      geenInteresse += 1;
    } else if (isGeenContactStatus(l.status)) {
      geenContact += 1;
    }

    const status = (l.status || "").trim().toLowerCase();
    if (status && status !== "nieuw") {
      nonNieuwGebeld += 1;
      if (isIngepland) nonNieuwIngepland += 1;
    }
  }

  // Uitval: nieuw-huisbezoeken gezet in venster die geannuleerd zijn
  let geannuleerd = 0;
  for (const a of opts.afspraken) {
    if (!isHuisbezoekSoort(a)) continue;
    if (a.status !== "geannuleerd") continue;
    if (!a.created_at) continue;
    if (!inAmsterdamDayRange(a.created_at, start, end)) continue;
    if (filterBeller) {
      const door = (a.ingepland_door_id || "").trim();
      const attributed =
        door && !(opts.skipAdminIds && opts.skipAdminIds.has(door))
          ? door
          : opts.fallbackBellerId || null;
      if (attributed !== filterBeller) continue;
    }
    geannuleerd += 1;
  }

  const gebeld = byId.size;
  const l2a = safeDiv(nonNieuwIngepland, nonNieuwGebeld);
  const uitval = safeDiv(geannuleerd, ingepland + geannuleerd);
  return {
    ingepland,
    gebeld,
    geenInteresse,
    geenContact,
    geannuleerd,
    annuleringsPct: uitval != null ? round2(uitval * 100) : null,
    nonNieuwGebeld,
    nonNieuwIngepland,
    leadToAppt: l2a != null ? round2(l2a * 100) : null,
  };
}

function dayBucketLabel(ymd: string): string {
  const noon = noonAmsterdamFromYmd(ymd);
  return formatInTimeZone(noon, AMSTERDAM_TZ, "EEE d MMM", { locale: nl });
}

function weekBucketLabel(
  week: number,
  startYmd: string,
  endYmd: string
): string {
  const a = formatInTimeZone(
    noonAmsterdamFromYmd(startYmd),
    AMSTERDAM_TZ,
    "d MMM",
    { locale: nl }
  );
  const b = formatInTimeZone(
    noonAmsterdamFromYmd(endYmd),
    AMSTERDAM_TZ,
    "d MMM",
    { locale: nl }
  );
  return `W${week} · ${a}–${b}`;
}

/** Lege bucket-skeletten voor dag- of week-granulariteit. */
export function listBelSeriesBucketFrames(
  rangeStartYmd: string,
  rangeEndYmd: string,
  granularity: BelConversieSeriesGranularity
): Pick<BelConversieSeriesBucket, "key" | "label" | "startYmd" | "endYmd">[] {
  if (rangeStartYmd > rangeEndYmd) return [];

  if (granularity === "day") {
    const out: Pick<
      BelConversieSeriesBucket,
      "key" | "label" | "startYmd" | "endYmd"
    >[] = [];
    let cur = rangeStartYmd;
    while (cur <= rangeEndYmd) {
      out.push({
        key: cur,
        label: dayBucketLabel(cur),
        startYmd: cur,
        endYmd: cur,
      });
      cur = shiftAmsterdamYmdLocal(cur, 1);
    }
    return out;
  }

  // Week: ISO-weken die het bereik raken, geclipped tot range
  const seen = new Set<string>();
  const out: Pick<
    BelConversieSeriesBucket,
    "key" | "label" | "startYmd" | "endYmd"
  >[] = [];
  let cur = rangeStartYmd;
  while (cur <= rangeEndYmd) {
    const noon = noonAmsterdamFromYmd(cur);
    const info = schouwWeekFromDate(noon);
    const key = `${info.jaar}-W${String(info.week).padStart(2, "0")}`;
    if (!seen.has(key)) {
      seen.add(key);
      const monday = String(
        schouwWeekToMondayIso(info.jaar, info.week)
      ).slice(0, 10);
      const sunday = shiftAmsterdamYmdLocal(monday, 6);
      const startYmd = monday < rangeStartYmd ? rangeStartYmd : monday;
      const endYmd = sunday > rangeEndYmd ? rangeEndYmd : sunday;
      out.push({
        key,
        label: weekBucketLabel(info.week, startYmd, endYmd),
        startYmd,
        endYmd,
      });
    }
    cur = shiftAmsterdamYmdLocal(cur, 1);
  }
  return out;
}

/**
 * Tijdreeks voor staafgrafiek.
 * `day` = per kalenderdag; `week` = per ISO-week (binnen van–tot).
 */
export function buildBelConversieSeries(opts: {
  rangeStartYmd: string;
  rangeEndYmd: string;
  granularity: BelConversieSeriesGranularity;
  leads: BelConversieLead[];
  afspraken: BelConversieAfspraak[];
  huisbezoekHistorie?: BelConversieAfspraak[];
  bellerId?: string | null;
  fallbackBellerId?: string | null;
  skipAdminIds?: ReadonlySet<string> | null;
  /** Ingepland-doel per bel-werkdag (grafiek-lijn). */
  doelPerDag?: number | null;
  /** Ingepland-doel per weekbucket (maand-view). */
  doelPerWeek?: number | null;
}): BelConversieSeriesBucket[] {
  const doelDag = Math.max(0, Math.round(opts.doelPerDag ?? 0));
  const doelWeek = Math.max(
    0,
    Math.round(opts.doelPerWeek ?? doelDag * BEL_WORKDAYS_PER_WEEK)
  );
  const frames = listBelSeriesBucketFrames(
    opts.rangeStartYmd,
    opts.rangeEndYmd,
    opts.granularity
  );
  return frames.map((f) => {
    const scored = scoreBelConversieWindow({
      startYmd: f.startYmd,
      endYmd: f.endYmd,
      leads: opts.leads,
      afspraken: opts.afspraken,
      huisbezoekHistorie: opts.huisbezoekHistorie,
      bellerId: opts.bellerId,
      fallbackBellerId: opts.fallbackBellerId,
      skipAdminIds: opts.skipAdminIds,
    });
    let doel = 0;
    if (opts.granularity === "day") {
      doel = isAmsterdamWeekday(f.startYmd) ? doelDag : 0;
    } else {
      const workdays = countWeekdaysInclusive(f.startYmd, f.endYmd);
      doel =
        doelDag > 0
          ? doelDag * workdays
          : workdays > 0
            ? Math.round((doelWeek * workdays) / BEL_WORKDAYS_PER_WEEK)
            : 0;
    }
    return { ...f, ...scored, doel };
  });
}


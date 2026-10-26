/**
 * Week-sales dashboard (Huub maandagmeeting):
 * conversieketen per adviseur + aankomende-week huisbezoeken.
 */

import {
  addDays,
  getISOWeek,
  getISOWeekYear,
  startOfWeek,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AMSTERDAM_TZ } from "@/lib/format";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import {
  afspraakBlokkeertAgenda,
  afspraakIsAfgelopen,
  isSaleUitkomst,
  normalizeAfspraakSoort,
  VERVOLG_PUNT_VRIJGESTELD,
} from "@/lib/afspraak-soort";
import type { LeadStatus } from "@/types/database";
import {
  dayKeyAmsterdam,
  isBeforeStartdatum,
  isSlotGeblokkeerd,
  loadAfblokkingen,
  loadSlotVrijgaven,
  nearestSlotHour,
  weekKeyFromDate,
  weekKeyString,
} from "@/lib/adviseur-beschikbaarheid";
import {
  AFSPRAAK_DUUR_MINUTEN,
  generateDayBlocks,
  type BusySlot,
} from "@/lib/slots";
import {
  PERIOD_PRESET_LABELS,
  resolveMgmtPeriod,
  type MgmtPeriodPreset,
} from "@/lib/management-dashboard/periods";
import { AFSPRAAK_UITKOMSTEN, normalizeProjectStatus } from "@/lib/labels";
import type { Afspraak } from "@/types/database";

export type SalesManagerPeriod =
  | "last_week"
  | "this_week"
  | "last_7_days"
  | "last_14_days"
  | "last_30_days"
  | "this_month"
  | "last_month"
  | "custom";

export const SALES_MANAGER_PERIODS: SalesManagerPeriod[] = [
  "last_week",
  "this_week",
  "last_7_days",
  "last_14_days",
  "last_30_days",
  "this_month",
  "last_month",
  "custom",
];

export const SALES_MANAGER_PERIOD_LABELS: Record<SalesManagerPeriod, string> = {
  last_week: PERIOD_PRESET_LABELS.last_week,
  this_week: PERIOD_PRESET_LABELS.this_week,
  last_7_days: PERIOD_PRESET_LABELS.last_7_days,
  last_14_days: PERIOD_PRESET_LABELS.last_14_days,
  last_30_days: PERIOD_PRESET_LABELS.last_30_days,
  this_month: PERIOD_PRESET_LABELS.this_month,
  last_month: PERIOD_PRESET_LABELS.last_month,
  custom: PERIOD_PRESET_LABELS.custom,
};

export type SalesManagerPeriodInput = {
  period: SalesManagerPeriod;
  customStart?: string | null;
  customEnd?: string | null;
};

export type SalesManagerResolvedPeriod = {
  period: SalesManagerPeriod;
  label: string;
  /** Inclusief start (Amsterdam) */
  startIso: string;
  /** Inclusief eind (einde Amsterdam-dag) */
  endIso: string;
  startYmd: string;
  endYmd: string;
};

export type SalesManagerRow = {
  adviseur_id: string;
  naam: string;
  /** Nieuwe huisbezoeken (soort nieuw) met start_at in periode — niet created_at */
  ingepland: number;
  /** Afgelopen nieuwe huisbezoeken in periode (mét én zonder afboeking) */
  gelopen: number;
  /** Subset van gelopen: nog zonder uitkomst (apart zichtbaar) */
  niet_afgeboekt: number;
  /** gelopen / ingepland */
  conversie_ingepland_gelopen_pct: number | null;
  /** Bruto sales: getekende offertes in periode, zonder project-annuleringen */
  sales: number;
  /** Bruto sales-conversie: sales / ingepland */
  conversie_ingepland_sale_pct: number | null;
  /** Fysieke huisbezoeken in aankomende kalenderweek */
  afspraken_aankomende_week: number;
  /** Nog vrije tijdblokken in aankomende kalenderweek */
  blokken_aankomende_week: number;
};

export type SalesManagerTotals = {
  adviseurs: number;
  ingepland: number;
  gelopen: number;
  niet_afgeboekt: number;
  conversie_ingepland_gelopen_pct: number | null;
  sales: number;
  conversie_ingepland_sale_pct: number | null;
  afspraken_aankomende_week: number;
  blokken_aankomende_week: number;
};

export type SalesManagerWeekPoint = {
  weekKey: string;
  label: string;
  ingepland: number;
  gelopen: number;
  niet_afgeboekt: number;
  sales: number;
  conversie_ingepland_sale_pct: number | null;
};

export type SalesManagerTimelineKind =
  | "sollicitatie"
  | "contract"
  | "eerste_afspraak"
  | "startdatum"
  | "deal";

export type SalesManagerTimelineEvent = {
  kind: SalesManagerTimelineKind;
  at: string;
  titel: string;
  detail: string | null;
  lead_id?: string | null;
  offerte_id?: string | null;
  bedrag_inc?: number | null;
};

export type SalesManagerMapPin = {
  kind: "home" | "afspraak";
  id: string;
  lat: number;
  lng: number;
  label: string;
  subtitel: string | null;
  notitie: string | null;
  start_at: string | null;
  status: string | null;
  lead_id: string | null;
  lead_naam: string | null;
  lead_telefoon: string | null;
  lead_email: string | null;
  adres: string | null;
};

export type SalesManagerDetail = {
  adviseur_id: string;
  naam: string;
  email: string | null;
  start_adres: string | null;
  startdatum: string | null;
  contract_signed_at: string | null;
  contract_sign_status: string | null;
  row: SalesManagerRow;
  week_trend: SalesManagerWeekPoint[];
  timeline: SalesManagerTimelineEvent[];
  map_pins: SalesManagerMapPin[];
};

export function parseSalesManagerPeriod(
  raw: string | null | undefined
): SalesManagerPeriod {
  const v = (raw || "").trim();
  if ((SALES_MANAGER_PERIODS as string[]).includes(v)) {
    return v as SalesManagerPeriod;
  }
  return "last_week";
}

export function resolveSalesManagerPeriod(
  input: SalesManagerPeriodInput,
  now = new Date()
): SalesManagerResolvedPeriod {
  const resolved = resolveMgmtPeriod(
    {
      period: input.period as MgmtPeriodPreset,
      customStart: input.customStart,
      customEnd: input.customEnd,
    },
    now
  );
  let label = SALES_MANAGER_PERIOD_LABELS[input.period];
  if (input.period === "custom" && input.customStart && input.customEnd) {
    label = `${input.customStart} – ${input.customEnd}`;
  } else if (input.period === "last_week" || input.period === "this_week") {
    const a = formatInTimeZone(resolved.start, AMSTERDAM_TZ, "d MMM");
    const b = formatInTimeZone(resolved.end, AMSTERDAM_TZ, "d MMM yyyy");
    label = `${SALES_MANAGER_PERIOD_LABELS[input.period]} (${a} – ${b})`;
  }
  return {
    period: input.period,
    label,
    startIso: resolved.start.toISOString(),
    endIso: resolved.end.toISOString(),
    startYmd: formatInTimeZone(resolved.start, AMSTERDAM_TZ, "yyyy-MM-dd"),
    endYmd: formatInTimeZone(resolved.end, AMSTERDAM_TZ, "yyyy-MM-dd"),
  };
}

/**
 * Eerstvolgende planbare kalenderweek (ma–zo, Amsterdam).
 * Za/zo → volgende week (deze week heeft geen planbare dagen meer).
 * Ma–vr → deze week.
 */
export function upcomingWeekRangeAmsterdam(now = new Date()): {
  startIso: string;
  endIso: string;
  startYmd: string;
  endYmd: string;
  label: string;
  weekKey: string;
} {
  const z = toZonedTime(now, AMSTERDAM_TZ);
  const dow = z.getDay(); // 0=zo … 6=za
  const thisMon = startOfWeek(z, { weekStartsOn: 1 });
  const monLocal =
    dow === 0 || dow === 6 ? addDays(thisMon, 7) : thisMon;
  const start = fromZonedTime(
    new Date(
      monLocal.getFullYear(),
      monLocal.getMonth(),
      monLocal.getDate(),
      0,
      0,
      0,
      0
    ),
    AMSTERDAM_TZ
  );
  const end = fromZonedTime(
    new Date(
      monLocal.getFullYear(),
      monLocal.getMonth(),
      monLocal.getDate() + 6,
      23,
      59,
      59,
      999
    ),
    AMSTERDAM_TZ
  );
  const mid = toZonedTime(start, AMSTERDAM_TZ);
  const jaar = getISOWeekYear(mid);
  const week = getISOWeek(mid);
  const a = formatInTimeZone(start, AMSTERDAM_TZ, "d MMM");
  const b = formatInTimeZone(end, AMSTERDAM_TZ, "d MMM");
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startYmd: formatInTimeZone(start, AMSTERDAM_TZ, "yyyy-MM-dd"),
    endYmd: formatInTimeZone(end, AMSTERDAM_TZ, "yyyy-MM-dd"),
    label: `Week ${week} (${a} – ${b})`,
    weekKey: weekKeyString(jaar, week),
  };
}

function pct(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

async function loadUnavailableByAdviseur(
  sb: SupabaseClient,
  adviseurIds: string[],
  jaren: number[]
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (adviseurIds.length === 0 || jaren.length === 0) return map;
  const { data, error } = await sb
    .from("adviseur_beschikbaarheid")
    .select("adviseur_id, jaar, week, beschikbaar")
    .in("adviseur_id", adviseurIds)
    .in("jaar", jaren)
    .eq("beschikbaar", false);
  if (error) {
    if (
      error.code === "42703" ||
      error.code === "42P01" ||
      error.message?.includes("adviseur_beschikbaarheid") ||
      error.message?.includes("schema cache")
    ) {
      return map;
    }
    throw error;
  }
  for (const row of data || []) {
    const id = row.adviseur_id as string;
    const set = map.get(id) || new Set<string>();
    set.add(weekKeyString(Number(row.jaar), Number(row.week)));
    map.set(id, set);
  }
  return map;
}

/**
 * Nog vrije tijdblokken per adviseur in exact hetzelfde venster als
 * afspraken_aankomende_week (ma–zo van de eerstvolgende planbare week).
 *
 * “Vrij” = open slot dat nog niet bezet is. Al geplande huisbezoeken tellen
 * dus níet mee — meer afspraken dan vrije blokken is normaal als de week
 * al (bijna) vol zit.
 */
async function loadBlokkenAankomendeWeek(
  sb: SupabaseClient,
  adviseurs: {
    id: string;
    naam: string;
    actief?: boolean | null;
    rol?: string | null;
    email?: string | null;
    startdatum?: string | null;
  }[],
  upcoming: { startIso: string; endIso: string; weekKey: string },
  now: Date
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const ids = adviseurs.map((a) => a.id);
  if (ids.length === 0) return result;

  const z = toZonedTime(now, AMSTERDAM_TZ);
  const y = getISOWeekYear(z);
  const van = dayKeyAmsterdam(new Date(upcoming.startIso));
  const tot = dayKeyAmsterdam(new Date(upcoming.endIso));
  const rangeStart = new Date(upcoming.startIso).getTime();
  const rangeEnd = new Date(upcoming.endIso).getTime();

  const [unavailableByAdviseur, afblokkingen, vrijgaven, afsprakenCapRes] =
    await Promise.all([
      loadUnavailableByAdviseur(sb, ids, [y - 1, y, y + 1]),
      loadAfblokkingen(sb, { adviseurIds: ids, van, tot }),
      loadSlotVrijgaven(sb, { adviseurIds: ids, van, tot }),
      sb
        .from("afspraken")
        .select("adviseur_id, start_at, end_at, status, soort")
        .in("adviseur_id", ids)
        .gte("start_at", upcoming.startIso)
        .lte("start_at", upcoming.endIso)
        .neq("status", "geannuleerd"),
    ]);

  // Slot-cutoff = max(nu, weekstart): verleden telt niet als “vrij”,
  // maar op za/zo starten we wel bij maandag van de aankomende week.
  const weekStart = new Date(upcoming.startIso);
  const fromDate =
    weekStart.getTime() < now.getTime() ? now : weekStart;

  for (const adv of adviseurs) {
    const busy: BusySlot[] = (afsprakenCapRes.data || [])
      .filter(
        (a) =>
          a.adviseur_id === adv.id &&
          a.status !== "geannuleerd" &&
          a.status !== "voltooid" &&
          afspraakBlokkeertAgenda((a.soort as string | null) ?? null)
      )
      .map((a) => {
        const start = a.start_at as string;
        const end =
          a.end_at && a.end_at !== a.start_at
            ? (a.end_at as string)
            : new Date(
                new Date(start).getTime() + AFSPRAAK_DUUR_MINUTEN * 60_000
              ).toISOString();
        return { start_at: start, end_at: end };
      });

    const unavailable = unavailableByAdviseur.get(adv.id) || new Set();
    const blocks = generateDayBlocks({
      daysAhead: 8,
      busy,
      fromDate,
      weekdaysOnly: false,
    });

    let vrij = 0;
    for (const block of blocks) {
      const t = block.start.getTime();
      if (t < rangeStart || t > rangeEnd) continue;
      if (isBeforeStartdatum(block.start, adv.startdatum)) continue;

      const wk = weekKeyFromDate(block.start);
      if (unavailable.has(weekKeyString(wk.jaar, wk.week))) continue;

      const dag = dayKeyAmsterdam(block.start);
      const hour = nearestSlotHour(block.start);
      if (
        isSlotGeblokkeerd(
          adv.id,
          dag,
          hour,
          afblokkingen,
          vrijgaven
        )
      ) {
        continue;
      }

      if (!block.busy) vrij += 1;
    }
    result.set(adv.id, vrij);
  }
  return result;
}

function inRange(iso: string, startIso: string, endIso: string): boolean {
  return iso >= startIso && iso <= endIso;
}

/** Eerste/nieuwe huisbezoek — conversieketen telt alleen deze (op start_at). */
function isNieuwHuisbezoek(soort: string | null | undefined): boolean {
  return normalizeAfspraakSoort(soort) === "nieuw";
}

/** Offerte-ids waarvan het project op annulering staat — tellen niet mee als bruto sale. */
async function loadGeannuleerdeOfferteIds(
  sb: SupabaseClient,
  offerteIds: string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  if (offerteIds.length === 0) return out;
  const { data, error } = await sb
    .from("projecten")
    .select("offerte_id, status")
    .in("offerte_id", offerteIds);
  if (error) throw error;
  for (const p of data || []) {
    if (!p.offerte_id) continue;
    if (normalizeProjectStatus(p.status as string) === "annulering") {
      out.add(p.offerte_id as string);
    }
  }
  return out;
}

/**
 * Leads waarvan de getekende deal via offerte-actie is doorgezet naar backoffice
 * (= afgeboekt, ook als leadstatus nog niet sale_* is).
 */
async function loadDoorgezetteSaleLeadIds(
  sb: SupabaseClient,
  leadIds: string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  if (leadIds.length === 0) return out;

  const unique = [...new Set(leadIds)];
  const [{ data: offertes }, { data: projecten }] = await Promise.all([
    sb
      .from("offertes")
      .select("lead_id, actie_required, status")
      .in("lead_id", unique)
      .eq("status", "ondertekend"),
    sb
      .from("projecten")
      .select("lead_id, status")
      .in("lead_id", unique),
  ]);

  for (const o of offertes || []) {
    // actie_required === false → actie afgerond, doorgezet naar BO
    if (o.actie_required === false && o.lead_id) {
      out.add(o.lead_id as string);
    }
  }
  for (const p of projecten || []) {
    if (!p.lead_id) continue;
    if (normalizeProjectStatus(p.status as string) === "annulering") continue;
    out.add(p.lead_id as string);
  }
  return out;
}

/**
 * Echte afboek-uitkomst (agenda-checkout of BO-doorzetting).
 * Inclusief vervolg_fysiek / vervolg_tel — dat ís afboeken in de agenda
 * (daarna volgt een vervolg-afspraak). Alleen `afspraak` / `na_afspraak` /
 * `nieuw` zonder checkout telt als niet-afgeboekt.
 */
function hasSalesManagerUitkomst(
  leadId: string,
  leadStatus: string | null,
  doorgezetSaleLeadIds: Set<string>
): boolean {
  if (doorgezetSaleLeadIds.has(leadId)) return true;
  if (!leadStatus) return false;
  if (isSaleUitkomst(leadStatus as LeadStatus)) return true;
  // Agenda-checkout keuzes (incl. vervolg op locatie / telefonisch)
  if ((AFSPRAAK_UITKOMSTEN as readonly string[]).includes(leadStatus)) {
    return true;
  }
  if (VERVOLG_PUNT_VRIJGESTELD.has(leadStatus as LeadStatus)) return true;
  // Getekende deal = uitkomst van het bezoek (sale-type volgt later)
  if (leadStatus === "deal") return true;
  return false;
}

/**
 * Gelopen = afgelopen huisbezoek (wel of niet afgeboekt).
 * Niet-afgeboekt blijft apart zichtbaar als subset van gelopen.
 */
function isGelopenVoorSalesManager(
  shape: {
    lead_id: string;
    status: string;
    soort: string | null;
    start_at: string;
    end_at?: string | null;
  },
  _leadStatus: string | null,
  _doorgezetSaleLeadIds: Set<string>,
  now: Date
): boolean {
  if (!afspraakBlokkeertAgenda(shape.soort)) return false;
  if (shape.status === "geannuleerd") return false;
  return afspraakIsAfgelopen(shape as Afspraak, now);
}

/** Niet afgeboekt = afgelopen huisbezoek zónder uitkomst (ongeacht vervolg-afspraak). */
function isNietAfgeboektVoorSalesManager(
  shape: {
    lead_id: string;
    status: string;
    soort: string | null;
    start_at: string;
    end_at?: string | null;
  },
  leadStatus: string | null,
  doorgezetSaleLeadIds: Set<string>,
  now: Date
): boolean {
  if (!afspraakBlokkeertAgenda(shape.soort)) return false;
  if (shape.status === "geannuleerd") return false;
  if (!afspraakIsAfgelopen(shape as Afspraak, now)) return false;
  return !hasSalesManagerUitkomst(
    shape.lead_id,
    leadStatus,
    doorgezetSaleLeadIds
  );
}

type AfspraakRow = {
  id: string;
  adviseur_id: string | null;
  lead_id: string;
  status: string;
  soort: string | null;
  start_at: string;
  end_at: string | null;
  leads?:
    | { status?: string | null }
    | { status?: string | null }[]
    | null;
};

function leadStatusOf(a: AfspraakRow): string | null {
  const join = Array.isArray(a.leads) ? a.leads[0] : a.leads;
  return join?.status ?? null;
}

export async function buildSalesManagerDashboard(
  sb: SupabaseClient,
  input: SalesManagerPeriodInput,
  now = new Date()
): Promise<{
  period: SalesManagerResolvedPeriod;
  upcomingWeekLabel: string;
  rows: SalesManagerRow[];
  totals: SalesManagerTotals;
}> {
  const period = resolveSalesManagerPeriod(input, now);
  const upcoming = upcomingWeekRangeAmsterdam(now);

  const { data: adviseursRaw, error: advErr } = await sb
    .from("adviseurs")
    .select("id, naam, email, actief, rol, startdatum")
    .eq("actief", true)
    .order("naam");
  if (advErr) throw advErr;

  const adviseurs = (
    (adviseursRaw || []) as {
      id: string;
      naam: string;
      email?: string | null;
      actief?: boolean | null;
      rol?: string | null;
      startdatum?: string | null;
    }[]
  ).filter((a) => isPlanbaarAdviseur(a));

  const ids = adviseurs.map((a) => a.id);
  const emptyTotals = (): SalesManagerTotals => ({
    adviseurs: 0,
    ingepland: 0,
    gelopen: 0,
    niet_afgeboekt: 0,
    conversie_ingepland_gelopen_pct: null,
    sales: 0,
    conversie_ingepland_sale_pct: null,
    afspraken_aankomende_week: 0,
    blokken_aankomende_week: 0,
  });

  if (ids.length === 0) {
    return {
      period,
      upcomingWeekLabel: upcoming.label,
      rows: [],
      totals: emptyTotals(),
    };
  }

  // Ruim venster: periode + aankomende week + buffer voor needsVervolg
  const fetchFrom = addDays(
    new Date(
      Math.min(
        new Date(period.startIso).getTime(),
        new Date(upcoming.startIso).getTime()
      )
    ),
    -14
  ).toISOString();
  const fetchTo = addDays(
    new Date(
      Math.max(
        new Date(period.endIso).getTime(),
        new Date(upcoming.endIso).getTime()
      )
    ),
    2
  ).toISOString();

  const [{ data: afsprakenRaw }, { data: offertesRaw }, blokkenAankomend] =
    await Promise.all([
      sb
        .from("afspraken")
        .select(
          "id, adviseur_id, lead_id, status, soort, start_at, end_at, leads(status)"
        )
        .in("adviseur_id", ids)
        .gte("start_at", fetchFrom)
        .lte("start_at", fetchTo)
        .neq("status", "geannuleerd")
        .order("start_at"),
      sb
        .from("offertes")
        .select(
          "id, lead_id, status, ondertekend_op, leads(adviseur_id)"
        )
        .eq("status", "ondertekend")
        .not("ondertekend_op", "is", null)
        .gte("ondertekend_op", period.startIso)
        .lte("ondertekend_op", period.endIso),
      loadBlokkenAankomendeWeek(sb, adviseurs, upcoming, now),
    ]);

  const afspraken = (afsprakenRaw || []) as AfspraakRow[];

  const periodLeadIds = afspraken
    .filter(
      (a) =>
        isNieuwHuisbezoek(a.soort) &&
        inRange(a.start_at, period.startIso, period.endIso)
    )
    .map((a) => a.lead_id);
  const doorgezetSaleLeadIds = await loadDoorgezetteSaleLeadIds(
    sb,
    periodLeadIds
  );

  const ingepland = new Map<string, number>();
  const gelopen = new Map<string, number>();
  const nietAfgeboekt = new Map<string, number>();
  const aankomendeAfs = new Map<string, number>();

  for (const a of afspraken) {
    if (!a.adviseur_id) continue;

    // Rechtskolom: fysieke huisbezoeken die die week op de agenda staan
    if (
      isNieuwHuisbezoek(a.soort) &&
      inRange(a.start_at, upcoming.startIso, upcoming.endIso)
    ) {
      aankomendeAfs.set(
        a.adviseur_id,
        (aankomendeAfs.get(a.adviseur_id) || 0) + 1
      );
    }

    // Conversieketen: alleen nieuwe huisbezoeken die die periode óp de agenda stonden
    // (start_at in periode — niet wanneer ze zijn ingepland/created)
    if (!isNieuwHuisbezoek(a.soort)) continue;
    if (!inRange(a.start_at, period.startIso, period.endIso)) continue;

    const shape = {
      id: a.id,
      lead_id: a.lead_id,
      status: a.status,
      soort: a.soort,
      start_at: a.start_at,
      end_at: a.end_at,
    };
    const ls = leadStatusOf(a);

    ingepland.set(a.adviseur_id, (ingepland.get(a.adviseur_id) || 0) + 1);

    if (isGelopenVoorSalesManager(shape, ls, doorgezetSaleLeadIds, now)) {
      gelopen.set(a.adviseur_id, (gelopen.get(a.adviseur_id) || 0) + 1);
    }
    if (
      isNietAfgeboektVoorSalesManager(shape, ls, doorgezetSaleLeadIds, now)
    ) {
      nietAfgeboekt.set(
        a.adviseur_id,
        (nietAfgeboekt.get(a.adviseur_id) || 0) + 1
      );
    }
  }

  const offerteIds = (offertesRaw || [])
    .map((o) => o.id as string)
    .filter(Boolean);
  const geannuleerdOfferteIds = await loadGeannuleerdeOfferteIds(
    sb,
    offerteIds
  );

  const salesByAdv = new Map<string, number>();
  for (const o of offertesRaw || []) {
    if (geannuleerdOfferteIds.has(o.id as string)) continue;
    const leadJoin = Array.isArray(o.leads) ? o.leads[0] : o.leads;
    const aid = (leadJoin as { adviseur_id?: string | null } | null)
      ?.adviseur_id;
    if (!aid || !ids.includes(aid)) continue;
    salesByAdv.set(aid, (salesByAdv.get(aid) || 0) + 1);
  }

  const rows: SalesManagerRow[] = adviseurs.map((a) => {
    const ing = ingepland.get(a.id) || 0;
    const gel = gelopen.get(a.id) || 0;
    const niet = nietAfgeboekt.get(a.id) || 0;
    const sales = salesByAdv.get(a.id) || 0;
    return {
      adviseur_id: a.id,
      naam: a.naam,
      ingepland: ing,
      gelopen: gel,
      niet_afgeboekt: niet,
      conversie_ingepland_gelopen_pct: pct(gel, ing),
      sales,
      conversie_ingepland_sale_pct: pct(sales, ing),
      afspraken_aankomende_week: aankomendeAfs.get(a.id) || 0,
      blokken_aankomende_week: blokkenAankomend.get(a.id) || 0,
    };
  });

  const sum = (fn: (r: SalesManagerRow) => number) =>
    rows.reduce((s, r) => s + fn(r), 0);
  const totIngepland = sum((r) => r.ingepland);
  const totGelopen = sum((r) => r.gelopen);
  const totNiet = sum((r) => r.niet_afgeboekt);
  const totSales = sum((r) => r.sales);
  const totals: SalesManagerTotals = {
    adviseurs: rows.length,
    ingepland: totIngepland,
    gelopen: totGelopen,
    niet_afgeboekt: totNiet,
    conversie_ingepland_gelopen_pct: pct(totGelopen, totIngepland),
    sales: totSales,
    conversie_ingepland_sale_pct: pct(totSales, totIngepland),
    afspraken_aankomende_week: sum((r) => r.afspraken_aankomende_week),
    blokken_aankomende_week: sum((r) => r.blokken_aankomende_week),
  };

  return {
    period,
    upcomingWeekLabel: upcoming.label,
    rows,
    totals,
  };
}

export type SalesManagerPopupSale = {
  offerte_id: string;
  lead_id: string;
  lead_naam: string;
  ondertekend_op: string;
  bedrag_inc: number | null;
};

export type SalesManagerPopupAfspraak = {
  afspraak_id: string;
  lead_id: string;
  lead_naam: string;
  start_at: string;
  status: string;
};

export type SalesManagerPopup = {
  adviseur_id: string;
  naam: string;
  periodLabel: string;
  sales: SalesManagerPopupSale[];
  niet_afgeboekt: SalesManagerPopupAfspraak[];
};

/** Lichtgewicht popup: sales + niet-afgeboekte afspraken in de gekozen periode. */
export async function buildSalesManagerPopup(
  sb: SupabaseClient,
  adviseurId: string,
  input: SalesManagerPeriodInput,
  now = new Date()
): Promise<SalesManagerPopup | null> {
  const period = resolveSalesManagerPeriod(input, now);

  const { data: adv, error: advErr } = await sb
    .from("adviseurs")
    .select("id, naam")
    .eq("id", adviseurId)
    .maybeSingle();
  if (advErr) throw advErr;
  if (!adv) return null;

  const [{ data: afsprakenRaw }, { data: offertesRaw }] = await Promise.all([
    sb
      .from("afspraken")
      .select(
        "id, adviseur_id, lead_id, status, soort, start_at, end_at, leads(id, naam, status)"
      )
      .eq("adviseur_id", adviseurId)
      .gte("start_at", period.startIso)
      .lte("start_at", period.endIso)
      .neq("status", "geannuleerd")
      .order("start_at", { ascending: false }),
    sb
      .from("offertes")
      .select(
        "id, lead_id, status, ondertekend_op, totaal_inc_btw, leads(id, naam, adviseur_id)"
      )
      .eq("status", "ondertekend")
      .not("ondertekend_op", "is", null)
      .gte("ondertekend_op", period.startIso)
      .lte("ondertekend_op", period.endIso)
      .order("ondertekend_op", { ascending: false }),
  ]);

  type PopupAfspraakRow = {
    id: string;
    adviseur_id: string | null;
    lead_id: string;
    status: string;
    soort: string | null;
    start_at: string;
    end_at: string | null;
    leads?:
      | { id?: string; naam?: string | null; status?: string | null }
      | { id?: string; naam?: string | null; status?: string | null }[]
      | null;
  };

  const afspraken = (afsprakenRaw || []) as PopupAfspraakRow[];
  const doorgezetSaleLeadIds = await loadDoorgezetteSaleLeadIds(
    sb,
    afspraken.map((a) => a.lead_id)
  );

  const niet_afgeboekt: SalesManagerPopupAfspraak[] = [];
  for (const a of afspraken) {
    if (!isNieuwHuisbezoek(a.soort)) continue;
    const shape = {
      id: a.id,
      lead_id: a.lead_id,
      status: a.status,
      soort: a.soort,
      start_at: a.start_at,
      end_at: a.end_at,
    };
    const join = Array.isArray(a.leads) ? a.leads[0] : a.leads;
    const ls = join?.status ?? null;
    if (
      !isNietAfgeboektVoorSalesManager(shape, ls, doorgezetSaleLeadIds, now)
    ) {
      continue;
    }
    niet_afgeboekt.push({
      afspraak_id: a.id,
      lead_id: a.lead_id,
      lead_naam: (join?.naam || "").trim() || "Lead",
      start_at: a.start_at,
      status: a.status,
    });
  }

  const offerteIds = (offertesRaw || [])
    .map((o) => o.id as string)
    .filter(Boolean);
  const geannuleerdOfferteIds = await loadGeannuleerdeOfferteIds(
    sb,
    offerteIds
  );

  const sales: SalesManagerPopupSale[] = [];
  for (const o of offertesRaw || []) {
    if (geannuleerdOfferteIds.has(o.id as string)) continue;
    const leadJoin = Array.isArray(o.leads) ? o.leads[0] : o.leads;
    const lead = leadJoin as {
      id?: string;
      naam?: string | null;
      adviseur_id?: string | null;
    } | null;
    if (!lead || lead.adviseur_id !== adviseurId) continue;
    const at = o.ondertekend_op as string;
    if (!at) continue;
    const bedrag = Number(o.totaal_inc_btw);
    sales.push({
      offerte_id: o.id as string,
      lead_id: (o.lead_id as string) || lead.id || "",
      lead_naam: lead.naam?.trim() || "Lead",
      ondertekend_op: at,
      bedrag_inc: Number.isFinite(bedrag) && bedrag > 0 ? bedrag : null,
    });
  }

  return {
    adviseur_id: adviseurId,
    naam: (adv.naam as string) || "Adviseur",
    periodLabel: period.label,
    sales,
    niet_afgeboekt,
  };
}

function composeLeadAdres(lead: {
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
}): string | null {
  const street = [lead.straat, lead.huisnummer, lead.toevoeging]
    .filter(Boolean)
    .join(" ")
    .trim();
  const city = [lead.postcode, lead.plaats].filter(Boolean).join(" ").trim();
  const full = [street, city].filter(Boolean).join(", ").trim();
  return full || null;
}

async function geocodeMany(
  queries: { key: string; q: string }[]
): Promise<Map<string, { lat: number; lng: number }>> {
  const { geocodeAddress } = await import("@/lib/travel-time");
  const out = new Map<string, { lat: number; lng: number }>();
  const unique = new Map<string, string>();
  for (const item of queries) {
    const q = item.q.trim();
    if (!q || unique.has(item.key)) continue;
    unique.set(item.key, q);
  }
  const entries = [...unique.entries()];
  const concurrency = 4;
  for (let i = 0; i < entries.length; i += concurrency) {
    const slice = entries.slice(i, i + concurrency);
    const results = await Promise.all(
      slice.map(async ([key, q]) => {
        try {
          const loc = await geocodeAddress(q);
          return loc ? ([key, loc] as const) : null;
        } catch {
          return null;
        }
      })
    );
    for (const r of results) {
      if (r) out.set(r[0], { lat: r[1].lat, lng: r[1].lon });
    }
  }
  return out;
}

function weekBoundsFromOffset(weekOffset: number, now = new Date()) {
  const z = toZonedTime(now, AMSTERDAM_TZ);
  const thisMon = startOfWeek(z, { weekStartsOn: 1 });
  const monLocal = addDays(thisMon, weekOffset * 7);
  const start = fromZonedTime(
    new Date(
      monLocal.getFullYear(),
      monLocal.getMonth(),
      monLocal.getDate(),
      0,
      0,
      0,
      0
    ),
    AMSTERDAM_TZ
  );
  const end = fromZonedTime(
    new Date(
      monLocal.getFullYear(),
      monLocal.getMonth(),
      monLocal.getDate() + 6,
      23,
      59,
      59,
      999
    ),
    AMSTERDAM_TZ
  );
  const mid = toZonedTime(start, AMSTERDAM_TZ);
  const jaar = getISOWeekYear(mid);
  const week = getISOWeek(mid);
  const a = formatInTimeZone(start, AMSTERDAM_TZ, "d MMM");
  const b = formatInTimeZone(end, AMSTERDAM_TZ, "d MMM");
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    label: `W${week} ${a}–${b}`,
    weekKey: weekKeyString(jaar, week),
  };
}

/**
 * Detail: trend over recente weken + tijdlijn + kaart.
 */
export async function buildSalesManagerDetail(
  sb: SupabaseClient,
  adviseurId: string,
  input: SalesManagerPeriodInput,
  now = new Date()
): Promise<SalesManagerDetail | null> {
  const dash = await buildSalesManagerDashboard(sb, input, now);
  const row = dash.rows.find((r) => r.adviseur_id === adviseurId);
  if (!row) return null;

  const { data: adv, error: advErr } = await sb
    .from("adviseurs")
    .select(
      "id, naam, email, start_adres, startdatum, contract_signed_at, contract_sign_status"
    )
    .eq("id", adviseurId)
    .maybeSingle();
  if (advErr) throw advErr;
  if (!adv) return null;

  const email =
    ((adv.email as string | null) || "").trim().toLowerCase() || null;
  const startAdres =
    ((adv.start_adres as string | null) || "").trim() || null;
  const startdatum =
    ((adv.startdatum as string | null) || "").trim() || null;
  const contractSignedAt =
    ((adv.contract_signed_at as string | null) || "").trim() || null;
  const contractStatus =
    ((adv.contract_sign_status as string | null) || "").trim() || null;

  // Weektrend: vanaf de week van het eerste ingeplande huisbezoek t/m nu
  // (max. 52 weken; lege weken vóór eerste ingepland worden weggelaten)
  const histFromMax = weekBoundsFromOffset(-51, now).startIso;
  const histTo = weekBoundsFromOffset(0, now).endIso;

  const [{ data: histAfs }, { data: histOff }] = await Promise.all([
    sb
      .from("afspraken")
      .select(
        "id, lead_id, start_at, end_at, status, soort, leads(status)"
      )
      .eq("adviseur_id", adviseurId)
      .gte("start_at", histFromMax)
      .lte("start_at", histTo)
      .neq("status", "geannuleerd"),
    sb
      .from("offertes")
      .select("id, lead_id, ondertekend_op, leads(adviseur_id)")
      .eq("status", "ondertekend")
      .not("ondertekend_op", "is", null)
      .gte("ondertekend_op", histFromMax)
      .lte("ondertekend_op", histTo),
  ]);

  const histAfsRows = (histAfs || []) as AfspraakRow[];

  // Eerste week = kalenderweek van het vroegste nieuwe huisbezoek op de agenda
  let firstAfspraakAt: string | null = null;
  for (const a of histAfsRows) {
    if (!isNieuwHuisbezoek(a.soort)) continue;
    if (!firstAfspraakAt || a.start_at < firstAfspraakAt) {
      firstAfspraakAt = a.start_at;
    }
  }

  const thisMon = startOfWeek(toZonedTime(now, AMSTERDAM_TZ), {
    weekStartsOn: 1,
  });
  let startOffset = 0;
  if (firstAfspraakAt) {
    const firstMon = startOfWeek(
      toZonedTime(new Date(firstAfspraakAt), AMSTERDAM_TZ),
      { weekStartsOn: 1 }
    );
    const diffWeeks = Math.round(
      (thisMon.getTime() - firstMon.getTime()) / (7 * 86_400_000)
    );
    startOffset = -Math.min(Math.max(0, diffWeeks), 51);
  }

  const weekWindows = [];
  for (let i = startOffset; i <= 0; i++) {
    weekWindows.push(weekBoundsFromOffset(i, now));
  }

  const histGeannuleerd = await loadGeannuleerdeOfferteIds(
    sb,
    (histOff || []).map((o) => o.id as string).filter(Boolean)
  );
  const histDoorgezet = await loadDoorgezetteSaleLeadIds(
    sb,
    histAfsRows.map((a) => a.lead_id)
  );

  const week_trend_raw: SalesManagerWeekPoint[] = weekWindows.map((w) => {
    let ing = 0;
    let gel = 0;
    let niet = 0;
    for (const a of histAfsRows) {
      if (!isNieuwHuisbezoek(a.soort)) continue;
      if (!inRange(a.start_at, w.startIso, w.endIso)) continue;
      ing += 1;
      const shape = {
        id: a.id,
        lead_id: a.lead_id,
        status: a.status,
        soort: a.soort,
        start_at: a.start_at,
        end_at: a.end_at,
      };
      const ls = leadStatusOf(a);
      if (isGelopenVoorSalesManager(shape, ls, histDoorgezet, now)) {
        gel += 1;
      }
      if (isNietAfgeboektVoorSalesManager(shape, ls, histDoorgezet, now)) {
        niet += 1;
      }
    }
    let sales = 0;
    for (const o of histOff || []) {
      if (histGeannuleerd.has(o.id as string)) continue;
      const leadJoin = Array.isArray(o.leads) ? o.leads[0] : o.leads;
      const aid = (leadJoin as { adviseur_id?: string | null } | null)
        ?.adviseur_id;
      if (aid !== adviseurId) continue;
      const at = o.ondertekend_op as string;
      if (at && inRange(at, w.startIso, w.endIso)) sales += 1;
    }
    return {
      weekKey: w.weekKey,
      label: w.label,
      ingepland: ing,
      gelopen: gel,
      niet_afgeboekt: niet,
      sales,
      conversie_ingepland_sale_pct: pct(sales, ing),
    };
  });

  // Geen lege weken vóór de week met het eerste ingeplande huisbezoek
  const firstActiveIdx = week_trend_raw.findIndex((w) => w.ingepland > 0);
  const week_trend =
    firstActiveIdx < 0
      ? week_trend_raw.slice(-1)
      : week_trend_raw.slice(firstActiveIdx);

  // Tijdlijn (beknopt)
  let sollicitatieAt: string | null = null;
  if (email) {
    const { data: sol } = await sb
      .from("sollicitaties")
      .select("created_at")
      .ilike("email", email)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (sol?.created_at) sollicitatieAt = sol.created_at as string;
  }

  const { data: dealsRaw } = await sb
    .from("offertes")
    .select(
      "id, lead_id, totaal_inc_btw, ondertekend_op, leads(id, naam, adviseur_id)"
    )
    .eq("status", "ondertekend")
    .not("ondertekend_op", "is", null)
    .order("ondertekend_op", { ascending: false })
    .limit(200);

  const timeline: SalesManagerTimelineEvent[] = [];
  if (sollicitatieAt) {
    timeline.push({
      kind: "sollicitatie",
      at: sollicitatieAt,
      titel: "Aangemeld sales-vacature",
      detail: "Sollicitatie binnengekomen",
    });
  }
  if (startdatum) {
    const atIso = /^\d{4}-\d{2}-\d{2}$/.test(startdatum)
      ? fromZonedTime(
          new Date(
            Number(startdatum.slice(0, 4)),
            Number(startdatum.slice(5, 7)) - 1,
            Number(startdatum.slice(8, 10)),
            9,
            0,
            0
          ),
          AMSTERDAM_TZ
        ).toISOString()
      : startdatum;
    timeline.push({
      kind: "startdatum",
      at: atIso,
      titel: "Startdatum",
      detail: "Eerste werkdag",
    });
  }
  if (firstAfspraakAt) {
    timeline.push({
      kind: "eerste_afspraak",
      at: firstAfspraakAt,
      titel: "Eerste huisbezoek",
      detail: "Start van de weektrend",
    });
  }
  if (contractSignedAt) {
    timeline.push({
      kind: "contract",
      at: contractSignedAt,
      titel: "Samenwerkingsovereenkomst getekend",
      detail:
        contractStatus === "ondertekend"
          ? "ZZP-contract ondertekend"
          : contractStatus || null,
    });
  }
  let dealCount = 0;
  for (const o of dealsRaw || []) {
    const leadJoin = Array.isArray(o.leads) ? o.leads[0] : o.leads;
    const lead = leadJoin as {
      id?: string;
      naam?: string | null;
      adviseur_id?: string | null;
    } | null;
    if (!lead || lead.adviseur_id !== adviseurId) continue;
    const at = o.ondertekend_op as string;
    if (!at) continue;
    const bedrag = Number(o.totaal_inc_btw) || 0;
    timeline.push({
      kind: "deal",
      at,
      titel: `Deal · ${lead.naam?.trim() || "Lead"}`,
      detail:
        bedrag > 0
          ? `€ ${bedrag.toLocaleString("nl-NL", { maximumFractionDigits: 0 })}`
          : null,
      lead_id: (o.lead_id as string) || lead.id || null,
      offerte_id: o.id as string,
      bedrag_inc: bedrag || null,
    });
    dealCount += 1;
    if (dealCount >= 40) break;
  }
  timeline.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );

  // Kaart
  const mapFrom = addDays(now, -21).toISOString();
  const mapTo = addDays(now, 21).toISOString();
  const { data: mapAfs } = await sb
    .from("afspraken")
    .select(
      "id, start_at, status, soort, notities, lead_id, leads(id, naam, telefoon, email, straat, huisnummer, toevoeging, postcode, plaats)"
    )
    .eq("adviseur_id", adviseurId)
    .gte("start_at", mapFrom)
    .lte("start_at", mapTo)
    .neq("status", "geannuleerd")
    .order("start_at", { ascending: true })
    .limit(60);

  type MapAfspraak = {
    id: string;
    start_at: string;
    status: string | null;
    soort: string | null;
    notities: string | null;
    lead_id: string;
    leads?:
      | {
          id?: string;
          naam?: string | null;
          telefoon?: string | null;
          email?: string | null;
          straat?: string | null;
          huisnummer?: string | null;
          toevoeging?: string | null;
          postcode?: string | null;
          plaats?: string | null;
        }
      | {
          id?: string;
          naam?: string | null;
          telefoon?: string | null;
          email?: string | null;
          straat?: string | null;
          huisnummer?: string | null;
          toevoeging?: string | null;
          postcode?: string | null;
          plaats?: string | null;
        }[]
      | null;
  };

  const geoQueries: { key: string; q: string }[] = [];
  if (startAdres) geoQueries.push({ key: "home", q: startAdres });

  const afspraakMeta: {
    a: MapAfspraak;
    lead: NonNullable<Exclude<MapAfspraak["leads"], unknown[]>>;
    adres: string;
  }[] = [];

  for (const raw of (mapAfs || []) as MapAfspraak[]) {
    if (!afspraakBlokkeertAgenda(raw.soort)) continue;
    const leadJoin = Array.isArray(raw.leads) ? raw.leads[0] : raw.leads;
    if (!leadJoin) continue;
    const adres = composeLeadAdres(leadJoin);
    if (!adres) continue;
    afspraakMeta.push({ a: raw, lead: leadJoin, adres });
    geoQueries.push({ key: `afs:${raw.id}`, q: adres });
  }

  const geo = await geocodeMany(geoQueries);
  const map_pins: SalesManagerMapPin[] = [];
  const homeLoc = geo.get("home");
  if (homeLoc && startAdres) {
    map_pins.push({
      kind: "home",
      id: "home",
      lat: homeLoc.lat,
      lng: homeLoc.lng,
      label: "Startadres",
      subtitel: (adv.naam as string) || row.naam,
      notitie: null,
      start_at: null,
      status: null,
      lead_id: null,
      lead_naam: null,
      lead_telefoon: null,
      lead_email: null,
      adres: startAdres,
    });
  }
  for (const { a, lead, adres } of afspraakMeta) {
    const loc = geo.get(`afs:${a.id}`);
    if (!loc) continue;
    map_pins.push({
      kind: "afspraak",
      id: a.id,
      lat: loc.lat,
      lng: loc.lng,
      label: lead.naam?.trim() || "Afspraak",
      subtitel: a.status || null,
      notitie: (a.notities || "").trim() || null,
      start_at: a.start_at,
      status: a.status,
      lead_id: a.lead_id || lead.id || null,
      lead_naam: lead.naam?.trim() || null,
      lead_telefoon: lead.telefoon?.trim() || null,
      lead_email: lead.email?.trim() || null,
      adres,
    });
  }

  return {
    adviseur_id: adviseurId,
    naam: (adv.naam as string) || row.naam,
    email,
    start_adres: startAdres,
    startdatum,
    contract_signed_at: contractSignedAt,
    contract_sign_status: contractStatus,
    row,
    week_trend,
    timeline,
    map_pins,
  };
}

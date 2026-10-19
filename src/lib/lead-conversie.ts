/**
 * Lead-conversie: targets uit open agenda-blokken × 2 ÷ L→A,
 * plus leads / L→A per bron (IG+FB → Meta).
 */

import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import { round2, safeDiv } from "@/lib/management-dashboard/periods";
import {
  BEL_WORKDAYS_PER_WEEK,
  countWeekdaysInclusive,
} from "@/lib/bel-conversie";

/** Afspraken-doel = open blokken × deze factor, daarna ÷ L→A → lead-doel. */
export const LEAD_BLOCKS_MULTIPLIER = 2;

export type LeadConversiePeriodProgress = {
  label: string;
  gehaald: number;
  doel: number;
  /** gehaald − doel (negatief = eronder, positief = erboven) */
  delta: number;
  nog: number;
  pct: number;
  finish: boolean;
  rangeStart: string;
  rangeEnd: string;
  /** Open agenda-blokken (beschikbaarheid) in dit venster */
  slotsOpen: number;
  /** Afspraken-doel = slotsOpen × 2 */
  afspraakDoel: number;
};

export type LeadConversieHorizonWeek = {
  jaar: number;
  week: number;
  label: string;
  slotsOpen: number;
  slotsVrij: number;
};

export type LeadConversieSourceRow = {
  source: string;
  leads: number;
  /**
   * Unieke leads uit het cohort (binnengekomen in periode) die minstens
   * één huisbezoek hebben (ingepland) — niet “alle afspraken in de periode”.
   */
  afspraken: number;
  /** Netto sales: unieke leads met getekende offerte, minus annuleringen */
  deals: number;
  /** Cohort L→A: afspraken ÷ leads (%) — max 100% */
  leadToAppt: number | null;
  /** deals ÷ afspraken (%) */
  apptToSale: number | null;
  /** Ad spend in het L→A-venster (Meta = meta_ad_spend) */
  spend: number;
  /** spend ÷ leads */
  cpl: number | null;
  /** spend ÷ afspraken */
  costPerAppointment: number | null;
  /** spend ÷ deals (CPA) */
  cpa: number | null;
};

/**
 * Ad-spend forecast om open agenda te vullen, obv actuele Meta CPL / €/afspraak.
 */
export type LeadConversieSpendForecast = {
  /** Open blokken komende ~14 dagen */
  slotsOpen: number;
  /** Afspraken-doel = open × 2 */
  afspraakDoel: number;
  /** Leads nodig = afspraakDoel ÷ L→A */
  leadsNodig: number;
  /** Huidige Meta CPL (spend ÷ leads in kanaalperiode) */
  cpl: number | null;
  /** Huidige Meta €/afspraak (spend ÷ afspraken) */
  costPerAppointment: number | null;
  /** leadsNodig × CPL — budget via lead-volume */
  spendViaCpl: number | null;
  /** costPerAppointment × open blokken — budget via vrije slots */
  spendViaCostPerAppt: number | null;
  /** costPerAppointment × afspraakDoel (open × 2) */
  spendViaAfspraakDoel: number | null;
};

export type LeadConversieResult = {
  date: string;
  period?: string;
  periodLabel?: string;
  periodDays?: number;
  rangeStartYmd?: string;
  rangeEndYmd?: string;
  leadToApptActueel: number | null;
  l2aWindowDays: number;
  l2aLeads: number;
  l2aAfspraken: number;
  /** Open blokken (beschikbaarheid) rest van de maand */
  slotsOpenMaand: number;
  slotsOpenWeek: number;
  slotsOpenBiweekly: number;
  horizonWeeks: LeadConversieHorizonWeek[];
  /** Primair: lead-doel bi-weekly = ceil(slotsOpenBiweekly × 2 / L→A) */
  leadsNodigBiweekly: number;
  /** Secundair: maand-doel (zelfde formule, bredere horizon) */
  leadsNodigMaand: number;
  /** Bel-werkdagen in bi-weekly venster (vooruit) */
  werkdagenBiweekly: number;
  /** Resterende bel-werkdagen t/m eind maand */
  werkdagenMaand: number;
  /** Totale Meta spend in L→A-venster */
  metaSpend: number;
  /** Ad-budget forecast (Meta CPL / €/afspraak × open blokken) */
  spendForecast: LeadConversieSpendForecast;
  /** Hoofddoel (tempo uit bi-weekly lead-doel) */
  dag: LeadConversiePeriodProgress;
  maand: LeadConversiePeriodProgress;
  week: LeadConversiePeriodProgress;
  biweekly: LeadConversiePeriodProgress;
  bySource: LeadConversieSourceRow[];
};

/** Spend-forecast uit Meta-rij + open blokken. */
export function buildSpendForecast(opts: {
  slotsOpen: number;
  afspraakDoel: number;
  leadsNodig: number;
  cpl: number | null;
  costPerAppointment: number | null;
}): LeadConversieSpendForecast {
  const slotsOpen = Math.max(0, Math.round(opts.slotsOpen));
  const afspraakDoel = Math.max(0, Math.round(opts.afspraakDoel));
  const leadsNodig = Math.max(0, Math.round(opts.leadsNodig));
  const cpl =
    opts.cpl != null && Number.isFinite(opts.cpl) && opts.cpl > 0
      ? round2(opts.cpl)
      : null;
  const costPerAppointment =
    opts.costPerAppointment != null &&
    Number.isFinite(opts.costPerAppointment) &&
    opts.costPerAppointment > 0
      ? round2(opts.costPerAppointment)
      : null;
  return {
    slotsOpen,
    afspraakDoel,
    leadsNodig,
    cpl,
    costPerAppointment,
    spendViaCpl:
      cpl != null && leadsNodig > 0 ? round2(cpl * leadsNodig) : null,
    spendViaCostPerAppt:
      costPerAppointment != null && slotsOpen > 0
        ? round2(costPerAppointment * slotsOpen)
        : null,
    spendViaAfspraakDoel:
      costPerAppointment != null && afspraakDoel > 0
        ? round2(costPerAppointment * afspraakDoel)
        : null,
  };
}

export function todayAmsterdamYmd(now = new Date()): string {
  const z = toZonedTime(now, AMSTERDAM_TZ);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, "0");
  const d = String(z.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function amsDayBounds(ymd: string): { start: Date; end: Date } {
  const [y, m, d] = ymd.split("-").map(Number);
  return {
    start: fromZonedTime(new Date(y, m - 1, d, 0, 0, 0, 0), AMSTERDAM_TZ),
    end: fromZonedTime(new Date(y, m - 1, d, 23, 59, 59, 999), AMSTERDAM_TZ),
  };
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

/**
 * Lead-doel uit open blokken: (blokken × 2) ÷ L→A%.
 * Voorbeeld: 100 open × 2 = 200 afspraken-doel; bij 25% L→A → 800 leads.
 */
export function leadsNeededFromOpenBlocks(
  slotsOpen: number,
  leadToApptPct: number | null,
  multiplier = LEAD_BLOCKS_MULTIPLIER
): { leadsDoel: number; afspraakDoel: number; slotsOpen: number } {
  const open = Math.max(0, Math.round(slotsOpen));
  const afspraakDoel = open * Math.max(1, Math.round(multiplier));
  if (afspraakDoel <= 0) {
    return { leadsDoel: 0, afspraakDoel: 0, slotsOpen: open };
  }
  const pct =
    leadToApptPct != null && Number.isFinite(leadToApptPct) && leadToApptPct > 0
      ? leadToApptPct
      : 25;
  return {
    leadsDoel: Math.ceil((afspraakDoel * 100) / pct),
    afspraakDoel,
    slotsOpen: open,
  };
}

/** @deprecated — gebruik leadsNeededFromOpenBlocks */
export function leadsNeededForSlots(
  slotsVrij: number,
  leadToApptPct: number | null
): number {
  return leadsNeededFromOpenBlocks(slotsVrij, leadToApptPct, 1).leadsDoel;
}

export function periodProgress(
  label: string,
  gehaald: number,
  doel: number,
  rangeStart: string,
  rangeEnd: string,
  slotsOpen = 0,
  afspraakDoel = 0
): LeadConversiePeriodProgress {
  const g = Math.max(0, Math.round(gehaald));
  const d = Math.max(0, Math.round(doel));
  const delta = g - d;
  const nog = Math.max(0, d - g);
  const pct =
    d > 0 ? Math.min(100, Math.round((g / d) * 100)) : g > 0 ? 100 : 0;
  return {
    label,
    gehaald: g,
    doel: d,
    delta,
    nog,
    pct,
    finish: d > 0 ? g >= d : false,
    rangeStart,
    rangeEnd,
    slotsOpen: Math.max(0, Math.round(slotsOpen)),
    afspraakDoel: Math.max(0, Math.round(afspraakDoel)),
  };
}

/**
 * Normaliseer traffic-bron voor “Per kanaal”.
 * Alleen `bron` / `utm_source` — geen landers (an, g, d, a, h, …).
 * facebook / Instagram / fb / ig → Meta.
 */
export function normalizeLeadSource(opts: {
  bron?: string | null;
  utm_source?: string | null;
  /** Genegeerd: landers zijn geen UTM-kanalen */
  lander?: string | null;
}): string {
  const bron = (opts.bron || "").trim();
  const utm = (opts.utm_source || "").trim();
  let raw = "";
  if (bron && bron.toLowerCase() !== "website") raw = bron;
  else if (utm) raw = utm;
  else if (bron) raw = bron;
  else raw = "Onbekend";

  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (
    key.includes("facebook") ||
    key.includes("instagram") ||
    key === "fb" ||
    key === "ig" ||
    key === "meta" ||
    key.startsWith("meta") ||
    key.includes("fbads") ||
    key.includes("igads")
  ) {
    return "Meta";
  }
  if (key.includes("google") || key === "gads" || key === "adwords") {
    return "Google";
  }
  if (key === "native" || key.includes("native")) {
    return "Native";
  }
  // Korte lander-codes die per ongeluk in utm_source/bron staan → negeren
  if (/^[a-z]{1,2}$/i.test(raw.trim())) {
    return "Onbekend";
  }
  if (raw === "Onbekend") return raw;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function buildSourceRows(
  leads: {
    id: string;
    bron?: string | null;
    utm_source?: string | null;
    lander?: string | null;
    status?: string | null;
  }[],
  /**
   * Cohort: lead-ids uit `leads` die minstens één huisbezoek hebben.
   * L→A = |afspraakLeadIds ∩ leads| ÷ leads (per bron).
   */
  afspraakLeadIds: Set<string> = new Set(),
  /** Spend per genormaliseerde bron (bijv. Meta ← meta_ad_spend) */
  spendBySource: Record<string, number> = {},
  /**
   * @deprecated Genegeerd — deals komen uit `dealsBySource`.
   */
  _nettoDealLeadIds: Set<string> = new Set(),
  /**
   * @deprecated Genegeerd — afspraken komen uit cohort `afspraakLeadIds`.
   */
  _afsprakenBySource: Record<string, number> = {},
  /**
   * Netto deals getekend in de periode, per bron (incl. oudere Meta/ig/fb leads).
   * CPA = spend ÷ deze deals.
   */
  dealsBySource: Record<string, number> = {}
): LeadConversieSourceRow[] {
  type Acc = { leads: number; afspraken: number; deals: number };
  const by = new Map<string, Acc>();
  for (const l of leads) {
    const source = normalizeLeadSource(l);
    let acc = by.get(source);
    if (!acc) {
      acc = { leads: 0, afspraken: 0, deals: 0 };
      by.set(source, acc);
    }
    acc.leads += 1;
    // Cohort: alleen meegetelde leads die zelf een huisbezoek hebben
    if (afspraakLeadIds.has(l.id)) {
      acc.afspraken += 1;
    }
  }
  // Deals = getekend in periode (niet cohort); unieke leads per bron
  for (const [source, n] of Object.entries(dealsBySource)) {
    let acc = by.get(source);
    if (!acc) {
      acc = { leads: 0, afspraken: 0, deals: 0 };
      by.set(source, acc);
    }
    acc.deals = Math.max(0, Math.round(n));
  }
  // Zorg dat kanalen met spend zichtbaar zijn ook zonder leads
  for (const source of Object.keys(spendBySource)) {
    if (!by.has(source)) by.set(source, { leads: 0, afspraken: 0, deals: 0 });
  }

  return [...by.entries()]
    .map(([source, acc]) => {
      const l2a = safeDiv(acc.afspraken, acc.leads);
      const a2s = safeDiv(acc.deals, acc.afspraken);
      const spend = Math.max(0, Number(spendBySource[source]) || 0);
      const cplRaw = safeDiv(spend, acc.leads);
      const cpaApptRaw = safeDiv(spend, acc.afspraken);
      const cpaRaw = safeDiv(spend, acc.deals);
      return {
        source,
        leads: acc.leads,
        afspraken: acc.afspraken,
        deals: acc.deals,
        leadToAppt: l2a != null ? round2(l2a * 100) : null,
        apptToSale: a2s != null ? round2(a2s * 100) : null,
        spend: round2(spend),
        cpl: cplRaw != null ? round2(cplRaw) : null,
        costPerAppointment: cpaApptRaw != null ? round2(cpaApptRaw) : null,
        cpa: cpaRaw != null ? round2(cpaRaw) : null,
      };
    })
    .sort(
      (a, b) =>
        b.leads - a.leads ||
        b.afspraken - a.afspraken ||
        b.deals - a.deals ||
        a.source.localeCompare(b.source, "nl")
    );
}

export function buildLeadConversie(opts: {
  dateYmd: string;
  leadToApptActueel: number | null;
  l2aLeads: number;
  l2aAfspraken: number;
  l2aWindowDays?: number;
  slotsOpenMaand: number;
  slotsOpenWeek: number;
  slotsOpenBiweekly: number;
  horizonWeeks: LeadConversieHorizonWeek[];
  leadsDag: number;
  leadsWeek: number;
  leadsMaand: number;
  leadsBiweekly: number;
  weekStartYmd: string;
  weekEndYmd: string;
  monthStartYmd: string;
  monthEndYmd: string;
  /** Vooruit: start bi-weekly capaciteit (meestal vandaag) */
  biweeklyCapStartYmd: string;
  /** Vooruit: eind bi-weekly capaciteit (vandaag + 13d) */
  biweeklyCapEndYmd: string;
  /** Trailing: start leads bi-weekly (laatste 14d) */
  biweeklyLeadsStartYmd: string;
  biweeklyLeadsEndYmd: string;
  bySource: LeadConversieSourceRow[];
  metaSpend?: number;
}): LeadConversieResult {
  const l2a =
    opts.leadToApptActueel != null && Number.isFinite(opts.leadToApptActueel)
      ? round2(opts.leadToApptActueel)
      : null;

  const maandNeed = leadsNeededFromOpenBlocks(opts.slotsOpenMaand, l2a);
  const weekNeed = leadsNeededFromOpenBlocks(opts.slotsOpenWeek, l2a);
  const biNeed = leadsNeededFromOpenBlocks(opts.slotsOpenBiweekly, l2a);

  const werkdagenMaand = Math.max(
    1,
    countWeekdaysInclusive(opts.dateYmd, opts.monthEndYmd)
  );
  const werkdagenBiweekly = Math.max(
    1,
    countWeekdaysInclusive(
      opts.biweeklyCapStartYmd,
      opts.biweeklyCapEndYmd
    )
  );

  // Primair: dagoel = tempo om bi-weekly lead-doel te halen
  // (leadsNodig over 14d ÷ bel-werkdagen in dat venster)
  const dagDoel =
    biNeed.leadsDoel > 0
      ? Math.ceil(biNeed.leadsDoel / werkdagenBiweekly)
      : weekNeed.leadsDoel > 0
        ? Math.ceil(weekNeed.leadsDoel / BEL_WORKDAYS_PER_WEEK)
        : 0;

  // Weekdoel = dagoel × 5 bel-werkdagen (zelfde finishlijn-logica als bel-conversie).
  // Niet “open blokken deze week” — dat is bijna gelijk aan 1 dagoel mid-week.
  const weekDoel =
    dagDoel > 0
      ? dagDoel * BEL_WORKDAYS_PER_WEEK
      : weekNeed.leadsDoel;

  const dag = periodProgress(
    "Vandaag",
    opts.leadsDag,
    dagDoel,
    opts.dateYmd,
    opts.dateYmd,
    biNeed.slotsOpen,
    biNeed.afspraakDoel
  );
  const biweekly = periodProgress(
    "2 weken",
    opts.leadsBiweekly,
    biNeed.leadsDoel,
    opts.biweeklyLeadsStartYmd,
    opts.biweeklyLeadsEndYmd,
    biNeed.slotsOpen,
    biNeed.afspraakDoel
  );
  const week = periodProgress(
    "Deze week",
    opts.leadsWeek,
    weekDoel,
    opts.weekStartYmd,
    opts.weekEndYmd,
    weekNeed.slotsOpen,
    weekNeed.afspraakDoel
  );
  const maand = periodProgress(
    "Deze maand",
    opts.leadsMaand,
    maandNeed.leadsDoel,
    opts.monthStartYmd,
    opts.monthEndYmd,
    maandNeed.slotsOpen,
    maandNeed.afspraakDoel
  );

  const metaRow = opts.bySource.find((r) => r.source === "Meta");
  const spendForecast = buildSpendForecast({
    slotsOpen: biNeed.slotsOpen,
    afspraakDoel: biNeed.afspraakDoel,
    leadsNodig: biNeed.leadsDoel,
    cpl: metaRow?.cpl ?? null,
    costPerAppointment: metaRow?.costPerAppointment ?? null,
  });

  return {
    date: opts.dateYmd,
    leadToApptActueel: l2a,
    l2aWindowDays: opts.l2aWindowDays ?? 14,
    l2aLeads: Math.max(0, Math.round(opts.l2aLeads)),
    l2aAfspraken: Math.max(0, Math.round(opts.l2aAfspraken)),
    slotsOpenMaand: maandNeed.slotsOpen,
    slotsOpenWeek: weekNeed.slotsOpen,
    slotsOpenBiweekly: biNeed.slotsOpen,
    horizonWeeks: opts.horizonWeeks,
    leadsNodigBiweekly: biNeed.leadsDoel,
    leadsNodigMaand: maandNeed.leadsDoel,
    werkdagenBiweekly,
    werkdagenMaand,
    metaSpend: round2(Math.max(0, opts.metaSpend ?? 0)),
    spendForecast,
    dag,
    maand,
    week,
    biweekly,
    bySource: opts.bySource,
  };
}

export function leadToApptPct(
  afspraken: number,
  leads: number
): number | null {
  const r = safeDiv(afspraken, leads);
  return r != null ? round2(r * 100) : null;
}

/** Weekdoel ≈ maandtempo / ~4.3 weken — alleen nog voor fallbacks elders. */
export function scaleLeadTargets(weeklyLeads: number): {
  dag: number;
  week: number;
  maand: number;
} {
  const week = Math.max(0, Math.round(weeklyLeads));
  const dag = week > 0 ? Math.ceil(week / BEL_WORKDAYS_PER_WEEK) : 0;
  const maand = week > 0 ? Math.ceil((week * 30) / 7) : 0;
  return { dag, week, maand };
}

/**
 * Marketing-rapportage: Meta ad spend (Amsterdam) + leads/afspraken/deals/omzet uit DB.
 * CPL = spend/leads · CPA = spend/afspraken · CPD/CAC = spend/deals
 * RPA = omzet/afspraken · ROAS = omzet/spend · ROI = (omzet−spend)/spend
 */

import { addDays, addWeeks, format } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  formatSchouwWeekLabel,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import { normalizeAfspraakSoort } from "@/lib/afspraak-soort";

export type MarketingMetrics = {
  spend: number;
  leads: number;
  /** Nieuwe huisbezoeken ingepland (created_at in periode) */
  afspraken: number;
  deals: number;
  omzet: number;
  /** Cost per lead = spend / leads */
  cpl: number | null;
  /** Cost per appointment = spend / afspraken */
  cpa: number | null;
  /** Cost per deal (CAC) = spend / deals */
  cac: number | null;
  /** Result per appointment = omzet / afspraken */
  rpa: number | null;
  roas: number | null;
  roi: number | null;
  /**
   * Leads nodig om agenda te vullen (80% slots ÷ L→A).
   * Gezet in de API; null als niet berekend.
   */
  leadsNodig?: number | null;
};

export type MarketingCampaignRow = MarketingMetrics & {
  key: string;
  label: string;
};

export type MarketingDayBucket = MarketingMetrics & {
  dayKey: string;
  label: string;
  startYmd: string;
  endYmd: string;
};

export type MarketingWeekBucket = MarketingMetrics & {
  weekKey: string;
  label: string;
  startYmd: string;
  endYmd: string;
  campaigns: MarketingCampaignRow[];
  /** Dagen in deze week (voor drill-down) */
  days: MarketingDayBucket[];
};

export type MarketingMonthBucket = MarketingMetrics & {
  monthKey: string;
  label: string;
  startYmd: string;
  endYmd: string;
  weeks: MarketingWeekBucket[];
};

export type MarketingRapportage = {
  startYmd: string;
  endYmd: string;
  periodLabel: string;
  totals: MarketingMetrics;
  series: MarketingWeekBucket[];
  months: MarketingMonthBucket[];
  metaConfigured: boolean;
  lastSyncAt: string | null;
};

export type MarketingLead = {
  id: string;
  created_at: string;
  campaign_name?: string | null;
  utm_campaign?: string | null;
};

export type MarketingOfferte = {
  id: string;
  lead_id: string;
  status: string;
  ondertekend_op: string | null;
  subtotaal_ex_btw: number | null;
};

export type MarketingAfspraak = {
  id: string;
  lead_id: string;
  created_at: string | null;
  start_at: string;
  status: string | null;
  soort: string | null;
};

export type MarketingMetaRow = {
  datum: string;
  level: string;
  campaign_id?: string | null;
  campaign_name: string | null;
  spend: number;
};

function isNieuwHuisbezoek(soort: string | null | undefined): boolean {
  return normalizeAfspraakSoort(soort) === "nieuw";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function safeDiv(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  return a / b;
}

export function campaignKeyFromLead(l: {
  campaign_name?: string | null;
  utm_campaign?: string | null;
}): string {
  return (l.campaign_name || l.utm_campaign || "").trim() || "Onbekend";
}

export function campaignKeyFromMeta(name: string | null | undefined): string {
  return (name || "").trim() || "Onbekend";
}

/** Vergelijkbaar maken: spaties/+ normaliseren. */
export function normalizeCampaignKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "… - Kopie" → basisnaam (Meta heeft soms alleen de basiscampagne). */
export function stripKopieSuffix(raw: string): string {
  return raw.replace(/\s*-\s*kopie\s*$/i, "").trim();
}

export function baseCampaignKey(raw: string): string {
  return normalizeCampaignKey(stripKopieSuffix(raw));
}

/**
 * Map een lead-/utm-naam naar de Meta campaign_name (canonical),
 * zodat spend en leads op dezelfde rij landen.
 *
 * Volgorde:
 * 1. Exacte match (genormaliseerd)
 * 2. Lead "X - Kopie" → Meta "X" als Kopie niet bestaat
 * 3. Lead "X" → Meta "X - Kopie" als X niet bestaat maar Kopie wel
 */
export function resolveCampaignKey(
  raw: string,
  metaNames: Iterable<string>
): string {
  const trimmed = (raw || "").trim() || "Onbekend";
  if (trimmed === "Onbekend") return trimmed;

  const metaList = [...metaNames]
    .map((m) => (m || "").trim())
    .filter(Boolean);
  const byNorm = new Map(
    metaList.map((m) => [normalizeCampaignKey(m), m] as const)
  );

  const norm = normalizeCampaignKey(trimmed);
  if (byNorm.has(norm)) return byNorm.get(norm)!;

  const base = stripKopieSuffix(trimmed);
  const baseNorm = normalizeCampaignKey(base);

  // Lead heeft "- Kopie", Meta alleen de basis
  if (base !== trimmed && byNorm.has(baseNorm)) {
    return byNorm.get(baseNorm)!;
  }

  // Lead is basis, Meta draait alleen de "- Kopie"-variant
  const kopieName = `${base} - Kopie`;
  const kopieNorm = normalizeCampaignKey(kopieName);
  if (byNorm.has(kopieNorm)) {
    return byNorm.get(kopieNorm)!;
  }

  return trimmed;
}

/**
 * Weekrijen: campagnes zonder spend maar mét leads/afspraken/deals
 * samenvoegen met sibling die wél Meta-spend heeft (zelfde basisnaam).
 * Voorkomt “€0 spend + leads” door naamvarianten / timing.
 */
function collapseZeroSpendIntoSiblings(campMap: Map<string, Acc>): void {
  for (const [key, acc] of [...campMap.entries()]) {
    if (acc.spend > 0) continue;
    const hasActivity =
      acc.leadIds.size > 0 || acc.afspraken > 0 || acc.deals > 0;
    if (!hasActivity) {
      campMap.delete(key);
      continue;
    }
    if (key === "Onbekend") continue;

    const base = baseCampaignKey(key);
    let targetKey: string | null = null;
    for (const [k, a] of campMap) {
      if (k === key || a.spend <= 0) continue;
      if (baseCampaignKey(k) === base) {
        targetKey = k;
        break;
      }
    }
    if (!targetKey) continue;

    const t = campMap.get(targetKey)!;
    for (const id of acc.leadIds) t.leadIds.add(id);
    t.afspraken += acc.afspraken;
    t.deals += acc.deals;
    t.omzet += acc.omzet;
    campMap.delete(key);
  }
}

function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function noonAmsterdamFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
}

function shiftYmd(ymd: string, deltaDays: number): string {
  return ymdAmsterdam(addDays(noonAmsterdamFromYmd(ymd), deltaDays));
}

/** Default: 12 ISO-weken t/m vandaag (Amsterdam). */
export function defaultMarketingRange(now = new Date()): {
  startYmd: string;
  endYmd: string;
} {
  const today = ymdAmsterdam(toZonedTime(now, AMSTERDAM_TZ));
  const endInfo = schouwWeekFromDate(noonAmsterdamFromYmd(today));
  const endMonday = String(
    schouwWeekToMondayIso(endInfo.jaar, endInfo.week)
  ).slice(0, 10);
  const startMonday = ymdAmsterdam(
    addWeeks(noonAmsterdamFromYmd(endMonday), -11)
  );
  return { startYmd: startMonday, endYmd: today };
}

function finalizeMetrics(m: {
  spend: number;
  leads: number;
  afspraken: number;
  deals: number;
  omzet: number;
}): MarketingMetrics {
  const spend = round2(m.spend);
  const omzet = round2(m.omzet);
  const cpl = safeDiv(spend, m.leads);
  const cpa = safeDiv(spend, m.afspraken);
  const cac = safeDiv(spend, m.deals);
  const rpa = safeDiv(omzet, m.afspraken);
  const roas = safeDiv(omzet, spend);
  const roi = spend > 0 ? (omzet - spend) / spend : null;
  return {
    spend,
    leads: m.leads,
    afspraken: m.afspraken,
    deals: m.deals,
    omzet,
    cpl: cpl != null ? round2(cpl) : null,
    cpa: cpa != null ? round2(cpa) : null,
    cac: cac != null ? round2(cac) : null,
    rpa: rpa != null ? round2(rpa) : null,
    roas: roas != null ? round2(roas) : null,
    roi: roi != null ? round2(roi) : null,
  };
}

function ymdFromIso(iso: string): string {
  return formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "yyyy-MM-dd");
}

function inYmdRange(ymd: string, start: string, end: string): boolean {
  return ymd >= start && ymd <= end;
}

type Acc = {
  spend: number;
  leadIds: Set<string>;
  afspraken: number;
  deals: number;
  omzet: number;
};

function newAcc(): Acc {
  return { spend: 0, leadIds: new Set(), afspraken: 0, deals: 0, omzet: 0 };
}

function accToMetrics(a: Acc): MarketingMetrics {
  return finalizeMetrics({
    spend: a.spend,
    leads: a.leadIds.size,
    afspraken: a.afspraken,
    deals: a.deals,
    omzet: a.omzet,
  });
}

function listWeekWindows(
  startYmd: string,
  endYmd: string
): { weekKey: string; label: string; startYmd: string; endYmd: string }[] {
  const out: {
    weekKey: string;
    label: string;
    startYmd: string;
    endYmd: string;
  }[] = [];
  let cursor = startYmd;
  const endInfo = schouwWeekFromDate(noonAmsterdamFromYmd(endYmd));
  const lastKey = schouwWeekValue(endInfo.jaar, endInfo.week);
  for (let i = 0; i < 60; i++) {
    const info = schouwWeekFromDate(noonAmsterdamFromYmd(cursor));
    const weekKey = schouwWeekValue(info.jaar, info.week);
    const mon = String(schouwWeekToMondayIso(info.jaar, info.week)).slice(
      0,
      10
    );
    const sun = shiftYmd(mon, 6);
    out.push({
      weekKey,
      label: formatSchouwWeekLabel(info.jaar, info.week),
      startYmd: mon,
      endYmd: sun > endYmd ? endYmd : sun,
    });
    if (weekKey === lastKey) break;
    cursor = shiftYmd(mon, 7);
  }
  return out;
}

function monthKeyFromYmd(ymd: string): string {
  return ymd.slice(0, 7);
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = fromZonedTime(new Date(y, m - 1, 1, 12, 0, 0), AMSTERDAM_TZ);
  return formatInTimeZone(d, AMSTERDAM_TZ, "MMMM yyyy", { locale: nl });
}

export function buildMarketingRapportage(opts: {
  startYmd: string;
  endYmd: string;
  leads: MarketingLead[];
  offertes: MarketingOfferte[];
  afspraken?: MarketingAfspraak[];
  metaSpend: MarketingMetaRow[];
  metaConfigured?: boolean;
  lastSyncAt?: string | null;
}): MarketingRapportage {
  const { startYmd, endYmd } = opts;

  // Canonical Meta-namen eerst — daaraan matchen we lead/utm-namen
  const metaNames = new Set<string>();
  for (const m of opts.metaSpend) {
    if (m.level !== "campaign" && m.level !== "ad") continue;
    const n = campaignKeyFromMeta(m.campaign_name);
    if (n !== "Onbekend") metaNames.add(n);
  }

  const leadCampaign = new Map<string, string>();
  for (const l of opts.leads) {
    leadCampaign.set(
      l.id,
      resolveCampaignKey(campaignKeyFromLead(l), metaNames)
    );
  }

  const weeks = listWeekWindows(startYmd, endYmd);
  const weekAcc = new Map<string, Acc>();
  const weekCampAcc = new Map<string, Map<string, Acc>>();
  const dayAcc = new Map<string, Acc>();
  for (const w of weeks) {
    weekAcc.set(w.weekKey, newAcc());
    weekCampAcc.set(w.weekKey, new Map());
    // Altijd ma–zo (7 dagen), ook als de week nog loopt / deels buiten range
    const sun = shiftYmd(w.startYmd, 6);
    for (let ymd = w.startYmd; ymd <= sun; ymd = shiftYmd(ymd, 1)) {
      if (!dayAcc.has(ymd)) dayAcc.set(ymd, newAcc());
    }
  }

  function ensureCamp(weekKey: string, campKey: string): Acc {
    const map = weekCampAcc.get(weekKey)!;
    if (!map.has(campKey)) map.set(campKey, newAcc());
    return map.get(campKey)!;
  }

  function weekKeyForYmd(ymd: string): string | null {
    if (!inYmdRange(ymd, startYmd, endYmd)) return null;
    const info = schouwWeekFromDate(noonAmsterdamFromYmd(ymd));
    return schouwWeekValue(info.jaar, info.week);
  }

  function ensureDay(ymd: string): Acc | null {
    if (!dayAcc.has(ymd)) return null;
    return dayAcc.get(ymd)!;
  }

  // Spend (Meta) — canonical campaign_name
  for (const m of opts.metaSpend) {
    if (m.level !== "campaign" && m.level !== "ad") continue;
    if (!inYmdRange(m.datum, startYmd, endYmd)) continue;
    const wk = weekKeyForYmd(m.datum);
    if (!wk || !weekAcc.has(wk)) continue;
    const camp = resolveCampaignKey(
      campaignKeyFromMeta(m.campaign_name),
      metaNames
    );
    const spend = Number(m.spend) || 0;
    weekAcc.get(wk)!.spend += spend;
    ensureCamp(wk, camp).spend += spend;
    const da = ensureDay(m.datum);
    if (da) da.spend += spend;
  }

  // Leads (DB)
  for (const l of opts.leads) {
    const ymd = ymdFromIso(l.created_at);
    if (!inYmdRange(ymd, startYmd, endYmd)) continue;
    const wk = weekKeyForYmd(ymd);
    if (!wk || !weekAcc.has(wk)) continue;
    const camp = leadCampaign.get(l.id) || "Onbekend";
    weekAcc.get(wk)!.leadIds.add(l.id);
    ensureCamp(wk, camp).leadIds.add(l.id);
    ensureDay(ymd)?.leadIds.add(l.id);
  }

  // Afspraken: nieuwe huisbezoeken op created_at (wanneer ingepland)
  for (const a of opts.afspraken || []) {
    if (a.status === "geannuleerd") continue;
    if (!isNieuwHuisbezoek(a.soort)) continue;
    const at = a.created_at || a.start_at;
    if (!at) continue;
    const ymd = ymdFromIso(at);
    if (!inYmdRange(ymd, startYmd, endYmd)) continue;
    const wk = weekKeyForYmd(ymd);
    if (!wk || !weekAcc.has(wk)) continue;
    const camp = leadCampaign.get(a.lead_id) || "Onbekend";
    weekAcc.get(wk)!.afspraken += 1;
    ensureCamp(wk, camp).afspraken += 1;
    const da = ensureDay(ymd);
    if (da) da.afspraken += 1;
  }

  // Deals / omzet (DB, via lead-campagne)
  for (const o of opts.offertes) {
    if (o.status !== "ondertekend" || !o.ondertekend_op) continue;
    const ymd = ymdFromIso(o.ondertekend_op);
    if (!inYmdRange(ymd, startYmd, endYmd)) continue;
    const wk = weekKeyForYmd(ymd);
    if (!wk || !weekAcc.has(wk)) continue;
    const camp = leadCampaign.get(o.lead_id) || "Onbekend";
    const omzet = Number(o.subtotaal_ex_btw) || 0;
    const wa = weekAcc.get(wk)!;
    wa.deals += 1;
    wa.omzet += omzet;
    const ca = ensureCamp(wk, camp);
    ca.deals += 1;
    ca.omzet += omzet;
    const da = ensureDay(ymd);
    if (da) {
      da.deals += 1;
      da.omzet += omzet;
    }
  }

  const series: MarketingWeekBucket[] = weeks.map((w) => {
    const acc = weekAcc.get(w.weekKey) || newAcc();
    const camps = weekCampAcc.get(w.weekKey) || new Map();
    collapseZeroSpendIntoSiblings(camps);
    const campaigns: MarketingCampaignRow[] = [...camps.entries()]
      .map(([key, a]) => ({
        key,
        label: key,
        ...accToMetrics(a),
      }))
      .filter(
        (c) => c.spend > 0 || c.leads > 0 || c.afspraken > 0 || c.deals > 0
      )
      .sort(
        (a, b) =>
          b.spend - a.spend || b.omzet - a.omzet || b.leads - a.leads
      );
    const days: MarketingDayBucket[] = [];
    const weekSun = shiftYmd(w.startYmd, 6);
    for (let ymd = w.startYmd; ymd <= weekSun; ymd = shiftYmd(ymd, 1)) {
      const da = dayAcc.get(ymd) || newAcc();
      days.push({
        dayKey: ymd,
        label: format(noonAmsterdamFromYmd(ymd), "EEE d MMM", { locale: nl }),
        startYmd: ymd,
        endYmd: ymd,
        ...accToMetrics(da),
      });
    }
    return {
      weekKey: w.weekKey,
      label: w.label,
      startYmd: w.startYmd,
      endYmd: w.endYmd,
      ...accToMetrics(acc),
      campaigns,
      days,
    };
  });

  // Months: group weeks by month of week-start
  const monthMap = new Map<string, MarketingWeekBucket[]>();
  for (const wk of series) {
    const mk = monthKeyFromYmd(wk.startYmd);
    if (!monthMap.has(mk)) monthMap.set(mk, []);
    monthMap.get(mk)!.push(wk);
  }

  const months: MarketingMonthBucket[] = [...monthMap.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, weekList]) => {
      const sorted = [...weekList].sort((a, b) =>
        b.startYmd.localeCompare(a.startYmd)
      );
      const spend = sorted.reduce((s, w) => s + w.spend, 0);
      const leads = sorted.reduce((s, w) => s + w.leads, 0);
      const afspraken = sorted.reduce((s, w) => s + w.afspraken, 0);
      const deals = sorted.reduce((s, w) => s + w.deals, 0);
      const omzet = sorted.reduce((s, w) => s + w.omzet, 0);
      const startYmdM = sorted[sorted.length - 1]?.startYmd || startYmd;
      const endYmdM = sorted[0]?.endYmd || endYmd;
      return {
        monthKey,
        label: monthLabel(monthKey),
        startYmd: startYmdM,
        endYmd: endYmdM,
        ...finalizeMetrics({ spend, leads, afspraken, deals, omzet }),
        weeks: sorted,
      };
    });

  const totals = finalizeMetrics({
    spend: series.reduce((s, w) => s + w.spend, 0),
    leads: series.reduce((s, w) => s + w.leads, 0),
    afspraken: series.reduce((s, w) => s + w.afspraken, 0),
    deals: series.reduce((s, w) => s + w.deals, 0),
    omzet: series.reduce((s, w) => s + w.omzet, 0),
  });

  const periodLabel =
    startYmd === endYmd
      ? startYmd
      : `${format(noonAmsterdamFromYmd(startYmd), "d MMM", { locale: nl })} – ${format(noonAmsterdamFromYmd(endYmd), "d MMM yyyy", { locale: nl })}`;

  return {
    startYmd,
    endYmd,
    periodLabel,
    totals,
    series,
    months,
    metaConfigured: Boolean(opts.metaConfigured),
    lastSyncAt: opts.lastSyncAt ?? null,
  };
}

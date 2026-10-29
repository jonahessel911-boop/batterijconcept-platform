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
import {
  KNOWN_MARKETING_SOURCES,
  normalizeLeadSource,
} from "@/lib/lead-conversie";

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

export type MarketingAdRow = MarketingMetrics & {
  key: string;
  label: string;
};

export type MarketingCampaignRow = MarketingMetrics & {
  key: string;
  label: string;
  /** Meta / TikTok / Google / Native / … */
  source: string;
  ads: MarketingAdRow[];
};

export const MARKETING_CHANNELS = ["social", "native", "search"] as const;
export type MarketingChannelKey = (typeof MARKETING_CHANNELS)[number];

export const MARKETING_CHANNEL_LABEL: Record<MarketingChannelKey, string> = {
  social: "Social",
  native: "Native",
  search: "Search",
};

/** Social = Meta/TikTok/Snap/… · Search = Google/Bing · rest → Native. */
export function marketingChannelForSource(source: string): MarketingChannelKey {
  const key = source.toLowerCase().replace(/[\s_-]+/g, "");
  if (
    key === "google" ||
    key === "gads" ||
    key === "adwords" ||
    key === "bing" ||
    key === "search" ||
    key.includes("google")
  ) {
    return "search";
  }
  if (
    key === "meta" ||
    key === "tiktok" ||
    key === "snap" ||
    key === "snapchat" ||
    key === "linkedin" ||
    key === "pinterest" ||
    key === "twitter" ||
    key === "x" ||
    key === "facebook" ||
    key === "instagram" ||
    key === "fb" ||
    key === "ig"
  ) {
    return "social";
  }
  return "native";
}

export type MarketingPlatformGroup = MarketingMetrics & {
  key: string;
  label: string;
  campaigns: MarketingCampaignRow[];
};

export type MarketingChannelGroup = MarketingMetrics & {
  key: MarketingChannelKey;
  label: string;
  platforms: MarketingPlatformGroup[];
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
  /** Flat (compat); UI gebruikt bij voorkeur `channels`. */
  campaigns: MarketingCampaignRow[];
  /** Social → Meta/TikTok · Native · Search → Google */
  channels: MarketingChannelGroup[];
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

/** Volledige marketing-slice voor één bron (zelfde shape als totalen). */
export type MarketingSourceSlice = {
  source: string;
  paid: boolean;
  spendConfigured: boolean;
  totals: MarketingMetrics;
  series: MarketingWeekBucket[];
  months: MarketingMonthBucket[];
};

export type MarketingRapportage = {
  startYmd: string;
  endYmd: string;
  periodLabel: string;
  totals: MarketingMetrics;
  series: MarketingWeekBucket[];
  months: MarketingMonthBucket[];
  /** Tabs: bronnen met activiteit + Meta/TikTok (geen Native). */
  sources: MarketingSourceRow[];
  /** Zelfde week-/maandreeks als totalen, per bron. */
  bySource: MarketingSourceSlice[];
  metaConfigured: boolean;
  /** TikTok Ads API nog niet gekoppeld — spend blijft 0 tot sync live is */
  tiktokConfigured: boolean;
  lastSyncAt: string | null;
};

export type MarketingLead = {
  id: string;
  created_at: string;
  campaign_name?: string | null;
  utm_campaign?: string | null;
  ad_name?: string | null;
  bron?: string | null;
  utm_source?: string | null;
  lander?: string | null;
};

export type MarketingSourceRow = MarketingMetrics & {
  source: string;
  /** Paid channel (Meta/TikTok) vs organic/partner (Native) */
  paid: boolean;
  /** Spend sync beschikbaar? */
  spendConfigured: boolean;
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
  ad_id?: string | null;
  ad_name?: string | null;
  spend: number;
};

export function adKeyFromLead(l: { ad_name?: string | null }): string {
  return (l.ad_name || "").trim() || "Onbekend";
}

export function adKeyFromMeta(row: {
  ad_name?: string | null;
  ad_id?: string | null;
}): string {
  return (row.ad_name || "").trim() || (row.ad_id || "").trim() || "Onbekend";
}

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
function mergeAccInto(target: Acc, from: Acc): void {
  for (const id of from.leadIds) target.leadIds.add(id);
  target.spend += from.spend;
  target.afspraken += from.afspraken;
  target.deals += from.deals;
  target.omzet += from.omzet;
}

function collapseZeroSpendIntoSiblings(
  campMap: Map<string, Acc>,
  adByCamp?: Map<string, Map<string, Acc>>
): void {
  for (const [key, acc] of [...campMap.entries()]) {
    if (acc.spend > 0) continue;
    const hasActivity =
      acc.leadIds.size > 0 || acc.afspraken > 0 || acc.deals > 0;
    if (!hasActivity) {
      campMap.delete(key);
      adByCamp?.delete(key);
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

    if (adByCamp) {
      const fromAds = adByCamp.get(key);
      if (fromAds) {
        let toAds = adByCamp.get(targetKey);
        if (!toAds) {
          toAds = new Map();
          adByCamp.set(targetKey, toAds);
        }
        for (const [adKey, adAcc] of fromAds) {
          const existing = toAds.get(adKey);
          if (existing) mergeAccInto(existing, adAcc);
          else toAds.set(adKey, adAcc);
        }
        adByCamp.delete(key);
      }
    }

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

function monthsFromSeries(
  series: MarketingWeekBucket[],
  startYmd: string,
  endYmd: string
): MarketingMonthBucket[] {
  const monthMap = new Map<string, MarketingWeekBucket[]>();
  for (const wk of series) {
    const mk = monthKeyFromYmd(wk.startYmd);
    if (!monthMap.has(mk)) monthMap.set(mk, []);
    monthMap.get(mk)!.push(wk);
  }
  return [...monthMap.entries()]
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
}

function sourceMeta(source: string, opts: {
  metaConfigured: boolean;
  tiktokConfigured: boolean;
}): { paid: boolean; spendConfigured: boolean } {
  if (source === "Meta") {
    return { paid: true, spendConfigured: opts.metaConfigured };
  }
  if (source === "TikTok") {
    return { paid: true, spendConfigured: opts.tiktokConfigured };
  }
  return { paid: false, spendConfigured: false };
}

function sumMetrics(rows: MarketingMetrics[]): MarketingMetrics {
  return finalizeMetrics({
    spend: rows.reduce((s, r) => s + r.spend, 0),
    leads: rows.reduce((s, r) => s + r.leads, 0),
    afspraken: rows.reduce((s, r) => s + r.afspraken, 0),
    deals: rows.reduce((s, r) => s + r.deals, 0),
    omzet: rows.reduce((s, r) => s + r.omzet, 0),
  });
}

function sortBySpendDesc<T extends MarketingMetrics & { label: string }>(
  rows: T[]
): T[] {
  return [...rows].sort(
    (a, b) =>
      b.spend - a.spend ||
      b.leads - a.leads ||
      b.omzet - a.omzet ||
      a.label.localeCompare(b.label, "nl")
  );
}

export function buildChannelsFromCampaigns(
  campaigns: MarketingCampaignRow[]
): MarketingChannelGroup[] {
  const byChannel = new Map<
    MarketingChannelKey,
    Map<string, MarketingCampaignRow[]>
  >();
  for (const ch of MARKETING_CHANNELS) {
    byChannel.set(ch, new Map());
  }
  for (const c of campaigns) {
    const ch = marketingChannelForSource(c.source);
    const platforms = byChannel.get(ch)!;
    const list = platforms.get(c.source) || [];
    list.push(c);
    platforms.set(c.source, list);
  }

  const channelOrder: MarketingChannelKey[] = ["social", "native", "search"];
  const out: MarketingChannelGroup[] = [];
  for (const ch of channelOrder) {
    const platformsMap = byChannel.get(ch)!;
    const platforms: MarketingPlatformGroup[] = [];
    for (const [source, camps] of platformsMap) {
      const sortedCamps = sortBySpendDesc(camps);
      platforms.push({
        key: source,
        label: source,
        campaigns: sortedCamps,
        ...sumMetrics(sortedCamps),
      });
    }
    const sortedPlatforms = sortBySpendDesc(platforms);
    if (sortedPlatforms.length === 0) {
      // Lege groep toch tonen zodat UX altijd Social/Native/Search heeft
      out.push({
        key: ch,
        label: MARKETING_CHANNEL_LABEL[ch],
        platforms: [],
        ...finalizeMetrics({
          spend: 0,
          leads: 0,
          afspraken: 0,
          deals: 0,
          omzet: 0,
        }),
      });
      continue;
    }
    out.push({
      key: ch,
      label: MARKETING_CHANNEL_LABEL[ch],
      platforms: sortedPlatforms,
      ...sumMetrics(sortedPlatforms),
    });
  }
  return out;
}

export function buildMarketingRapportage(opts: {
  startYmd: string;
  endYmd: string;
  leads: MarketingLead[];
  offertes: MarketingOfferte[];
  afspraken?: MarketingAfspraak[];
  metaSpend: MarketingMetaRow[];
  metaConfigured?: boolean;
  tiktokConfigured?: boolean;
  tiktokSpend?: number;
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
  const leadAd = new Map<string, string>();
  const leadSource = new Map<string, string>();
  for (const l of opts.leads) {
    leadCampaign.set(
      l.id,
      resolveCampaignKey(campaignKeyFromLead(l), metaNames)
    );
    leadAd.set(l.id, adKeyFromLead(l));
    leadSource.set(l.id, normalizeLeadSource(l));
  }

  const weeks = listWeekWindows(startYmd, endYmd);
  const weekAcc = new Map<string, Acc>();
  /** weekKey → source → campaign → Acc */
  const weekSourceCampAcc = new Map<
    string,
    Map<string, Map<string, Acc>>
  >();
  /** weekKey → source → campaign → ad → Acc */
  const weekSourceCampAdAcc = new Map<
    string,
    Map<string, Map<string, Map<string, Acc>>>
  >();
  const dayAcc = new Map<string, Acc>();
  /** weekKey → source → Acc */
  const weekSourceAcc = new Map<string, Map<string, Acc>>();
  /** ymd → source → Acc */
  const daySourceAcc = new Map<string, Map<string, Acc>>();
  const sourceNames = new Set<string>(KNOWN_MARKETING_SOURCES);

  for (const w of weeks) {
    weekAcc.set(w.weekKey, newAcc());
    weekSourceCampAcc.set(w.weekKey, new Map());
    weekSourceCampAdAcc.set(w.weekKey, new Map());
    weekSourceAcc.set(w.weekKey, new Map());
    // Altijd ma–zo (7 dagen), ook als de week nog loopt / deels buiten range
    const sun = shiftYmd(w.startYmd, 6);
    for (let ymd = w.startYmd; ymd <= sun; ymd = shiftYmd(ymd, 1)) {
      if (!dayAcc.has(ymd)) dayAcc.set(ymd, newAcc());
      if (!daySourceAcc.has(ymd)) daySourceAcc.set(ymd, new Map());
    }
  }

  function ensureSourceAcc(
    map: Map<string, Acc>,
    source: string
  ): Acc {
    if (!map.has(source)) map.set(source, newAcc());
    return map.get(source)!;
  }

  function ensureCamp(
    weekKey: string,
    source: string,
    campKey: string
  ): Acc {
    const bySource = weekSourceCampAcc.get(weekKey)!;
    let byCamp = bySource.get(source);
    if (!byCamp) {
      byCamp = new Map();
      bySource.set(source, byCamp);
    }
    if (!byCamp.has(campKey)) byCamp.set(campKey, newAcc());
    return byCamp.get(campKey)!;
  }

  function ensureCampAd(
    weekKey: string,
    source: string,
    campKey: string,
    adKey: string
  ): Acc {
    const bySource = weekSourceCampAdAcc.get(weekKey)!;
    let byCamp = bySource.get(source);
    if (!byCamp) {
      byCamp = new Map();
      bySource.set(source, byCamp);
    }
    let byAd = byCamp.get(campKey);
    if (!byAd) {
      byAd = new Map();
      byCamp.set(campKey, byAd);
    }
    if (!byAd.has(adKey)) byAd.set(adKey, newAcc());
    return byAd.get(adKey)!;
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

  // Spend (Meta) — campaign-level telt in totalen; ad-level alleen onder campagne
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
    const source = "Meta";
    if (m.level === "campaign") {
      weekAcc.get(wk)!.spend += spend;
      ensureCamp(wk, source, camp).spend += spend;
      ensureSourceAcc(weekSourceAcc.get(wk)!, source).spend += spend;
      sourceNames.add(source);
      const da = ensureDay(m.datum);
      if (da) da.spend += spend;
      const dsm = daySourceAcc.get(m.datum);
      if (dsm) ensureSourceAcc(dsm, source).spend += spend;
    } else {
      const ad = adKeyFromMeta(m);
      ensureCamp(wk, source, camp);
      ensureCampAd(wk, source, camp, ad).spend += spend;
    }
  }

  // Leads (DB)
  for (const l of opts.leads) {
    const ymd = ymdFromIso(l.created_at);
    if (!inYmdRange(ymd, startYmd, endYmd)) continue;
    const wk = weekKeyForYmd(ymd);
    if (!wk || !weekAcc.has(wk)) continue;
    const camp = leadCampaign.get(l.id) || "Onbekend";
    const ad = leadAd.get(l.id) || "Onbekend";
    const source = leadSource.get(l.id) || "Onbekend";
    weekAcc.get(wk)!.leadIds.add(l.id);
    ensureCamp(wk, source, camp).leadIds.add(l.id);
    ensureCampAd(wk, source, camp, ad).leadIds.add(l.id);
    ensureDay(ymd)?.leadIds.add(l.id);
    sourceNames.add(source);
    ensureSourceAcc(weekSourceAcc.get(wk)!, source).leadIds.add(l.id);
    const dsm = daySourceAcc.get(ymd);
    if (dsm) ensureSourceAcc(dsm, source).leadIds.add(l.id);
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
    const ad = leadAd.get(a.lead_id) || "Onbekend";
    const source = leadSource.get(a.lead_id) || "Onbekend";
    weekAcc.get(wk)!.afspraken += 1;
    ensureCamp(wk, source, camp).afspraken += 1;
    ensureCampAd(wk, source, camp, ad).afspraken += 1;
    const da = ensureDay(ymd);
    if (da) da.afspraken += 1;
    sourceNames.add(source);
    ensureSourceAcc(weekSourceAcc.get(wk)!, source).afspraken += 1;
    const dsm = daySourceAcc.get(ymd);
    if (dsm) ensureSourceAcc(dsm, source).afspraken += 1;
  }

  // Deals / omzet (DB, via lead-campagne)
  for (const o of opts.offertes) {
    if (o.status !== "ondertekend" || !o.ondertekend_op) continue;
    const ymd = ymdFromIso(o.ondertekend_op);
    if (!inYmdRange(ymd, startYmd, endYmd)) continue;
    const wk = weekKeyForYmd(ymd);
    if (!wk || !weekAcc.has(wk)) continue;
    const camp = leadCampaign.get(o.lead_id) || "Onbekend";
    const ad = leadAd.get(o.lead_id) || "Onbekend";
    const source = leadSource.get(o.lead_id) || "Onbekend";
    const omzet = Number(o.subtotaal_ex_btw) || 0;
    const wa = weekAcc.get(wk)!;
    wa.deals += 1;
    wa.omzet += omzet;
    const ca = ensureCamp(wk, source, camp);
    ca.deals += 1;
    ca.omzet += omzet;
    const aa = ensureCampAd(wk, source, camp, ad);
    aa.deals += 1;
    aa.omzet += omzet;
    const da = ensureDay(ymd);
    if (da) {
      da.deals += 1;
      da.omzet += omzet;
    }
    sourceNames.add(source);
    const sa = ensureSourceAcc(weekSourceAcc.get(wk)!, source);
    sa.deals += 1;
    sa.omzet += omzet;
    const dsm = daySourceAcc.get(ymd);
    if (dsm) {
      const dsa = ensureSourceAcc(dsm, source);
      dsa.deals += 1;
      dsa.omzet += omzet;
    }
  }

  const series: MarketingWeekBucket[] = weeks.map((w) => {
    const acc = weekAcc.get(w.weekKey) || newAcc();
    const bySourceCamps = weekSourceCampAcc.get(w.weekKey) || new Map();
    const bySourceAds = weekSourceCampAdAcc.get(w.weekKey) || new Map();

    const campaigns: MarketingCampaignRow[] = [];
    for (const [source, camps] of bySourceCamps) {
      const adsByCamp = bySourceAds.get(source) || new Map();
      collapseZeroSpendIntoSiblings(camps, adsByCamp);
      for (const [campKey, a] of camps) {
        const adMap = adsByCamp.get(campKey) || new Map();
        const ads = sortBySpendDesc(
          [...adMap.entries()]
            .map(([adKey, adAcc]) => ({
              key: adKey,
              label: adKey,
              ...accToMetrics(adAcc),
            }))
            .filter(
              (ad) =>
                ad.spend > 0 ||
                ad.leads > 0 ||
                ad.afspraken > 0 ||
                ad.deals > 0
            )
        );
        const row: MarketingCampaignRow = {
          key: campKey,
          label: campKey,
          source,
          ads,
          ...accToMetrics(a),
        };
        if (
          row.spend > 0 ||
          row.leads > 0 ||
          row.afspraken > 0 ||
          row.deals > 0
        ) {
          campaigns.push(row);
        }
      }
    }
    const sortedCampaigns = sortBySpendDesc(campaigns);
    const channels = buildChannelsFromCampaigns(sortedCampaigns);

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
      campaigns: sortedCampaigns,
      channels,
      days,
    };
  });

  const months = monthsFromSeries(series, startYmd, endYmd);

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

  const cfgFlags = {
    metaConfigured: Boolean(opts.metaConfigured),
    tiktokConfigured: Boolean(opts.tiktokConfigured),
  };

  const knownRank = (source: string): number => {
    const i = (KNOWN_MARKETING_SOURCES as readonly string[]).indexOf(source);
    return i >= 0 ? i : 100;
  };

  const bySource: MarketingSourceSlice[] = [...sourceNames]
    .sort((a, b) => {
      const ra = knownRank(a);
      const rb = knownRank(b);
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b, "nl");
    })
    .map((source) => {
      const srcSeries: MarketingWeekBucket[] = weeks.map((w, wi) => {
        const acc =
          weekSourceAcc.get(w.weekKey)?.get(source) || newAcc();
        const days: MarketingDayBucket[] = [];
        const weekSun = shiftYmd(w.startYmd, 6);
        for (let ymd = w.startYmd; ymd <= weekSun; ymd = shiftYmd(ymd, 1)) {
          const da =
            daySourceAcc.get(ymd)?.get(source) || newAcc();
          days.push({
            dayKey: ymd,
            label: format(noonAmsterdamFromYmd(ymd), "EEE d MMM", {
              locale: nl,
            }),
            startYmd: ymd,
            endYmd: ymd,
            ...accToMetrics(da),
          });
        }
        const overallWeek = series[wi];
        const sourceCamps = (overallWeek?.campaigns || []).filter(
          (c) => c.source === source
        );
        return {
          weekKey: w.weekKey,
          label: w.label,
          startYmd: w.startYmd,
          endYmd: w.endYmd,
          ...accToMetrics(acc),
          campaigns: sourceCamps,
          channels: buildChannelsFromCampaigns(sourceCamps),
          days,
        };
      });
      const srcMonths = monthsFromSeries(srcSeries, startYmd, endYmd);
      // Copieer leadsNodig van overall (capaciteit is bron-onafhankelijk)
      for (let i = 0; i < srcSeries.length; i++) {
        srcSeries[i]!.leadsNodig = series[i]?.leadsNodig ?? null;
        const days = srcSeries[i]!.days;
        const overallDays = series[i]?.days || [];
        for (let d = 0; d < days.length; d++) {
          days[d]!.leadsNodig = overallDays[d]?.leadsNodig ?? null;
        }
      }
      for (const m of srcMonths) {
        const overall = months.find((x) => x.monthKey === m.monthKey);
        m.leadsNodig = overall?.leadsNodig ?? null;
      }
      const srcTotals = finalizeMetrics({
        spend: srcSeries.reduce((s, w) => s + w.spend, 0),
        leads: srcSeries.reduce((s, w) => s + w.leads, 0),
        afspraken: srcSeries.reduce((s, w) => s + w.afspraken, 0),
        deals: srcSeries.reduce((s, w) => s + w.deals, 0),
        omzet: srcSeries.reduce((s, w) => s + w.omzet, 0),
      });
      const meta = sourceMeta(source, cfgFlags);
      return {
        source,
        ...meta,
        totals: srcTotals,
        series: srcSeries,
        months: srcMonths,
      };
    })
    .filter(
      (s) =>
        (KNOWN_MARKETING_SOURCES as readonly string[]).includes(s.source) ||
        s.totals.leads > 0 ||
        s.totals.afspraken > 0 ||
        s.totals.deals > 0 ||
        s.totals.spend > 0
    );

  const sources: MarketingSourceRow[] = bySource.map((s) => ({
    source: s.source,
    paid: s.paid,
    spendConfigured: s.spendConfigured,
    ...s.totals,
  }));

  return {
    startYmd,
    endYmd,
    periodLabel,
    totals,
    series,
    months,
    sources,
    bySource,
    metaConfigured: cfgFlags.metaConfigured,
    tiktokConfigured: cfgFlags.tiktokConfigured,
    lastSyncAt: opts.lastSyncAt ?? null,
  };
}

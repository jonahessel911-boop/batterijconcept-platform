/**
 * Sales-rapportage: zelfde week/maand-structuur als marketing-rapportage,
 * met sales-conversieketen (ingepland → gelopen → sale) per adviseur.
 */

import { addDays, addWeeks, format } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
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
import { AFSPRAAK_UITKOMSTEN, normalizeProjectStatus } from "@/lib/labels";
import {
  formatSchouwWeekLabel,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import type { Afspraak, LeadStatus } from "@/types/database";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

export type SalesMetrics = {
  ingepland: number;
  gelopen: number;
  niet_afgeboekt: number;
  sales: number;
  /** Getekende omzet ex btw */
  omzet: number;
  /** Average order value = omzet / sales */
  aov: number | null;
  /** Omzet per gelopen afspraak */
  omzet_per_gelopen: number | null;
  /** gelopen / ingepland */
  conv_ingepland_gelopen_pct: number | null;
  /** sales / gelopen */
  conv_gelopen_sale_pct: number | null;
  /** sales / ingepland (bruto) */
  conv_ingepland_sale_pct: number | null;
};

export type SalesAdviseurRow = SalesMetrics & {
  key: string;
  label: string;
};

export type SalesWeekBucket = SalesMetrics & {
  weekKey: string;
  label: string;
  startYmd: string;
  endYmd: string;
  adviseurs: SalesAdviseurRow[];
};

export type SalesMonthBucket = SalesMetrics & {
  monthKey: string;
  label: string;
  startYmd: string;
  endYmd: string;
  weeks: SalesWeekBucket[];
};

export type SalesRapportage = {
  startYmd: string;
  endYmd: string;
  periodLabel: string;
  totals: SalesMetrics;
  series: SalesWeekBucket[];
  months: SalesMonthBucket[];
};

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

type OfferteRow = {
  id: string;
  lead_id: string;
  status: string;
  ondertekend_op: string | null;
  subtotaal_ex_btw?: number | null;
  leads?:
    | { adviseur_id?: string | null }
    | { adviseur_id?: string | null }[]
    | null;
};

function pct(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function finalizeMetrics(m: {
  ingepland: number;
  gelopen: number;
  niet_afgeboekt: number;
  sales: number;
  omzet: number;
}): SalesMetrics {
  const omzet = round2(m.omzet);
  return {
    ingepland: m.ingepland,
    gelopen: m.gelopen,
    niet_afgeboekt: m.niet_afgeboekt,
    sales: m.sales,
    omzet,
    aov: m.sales > 0 ? round2(omzet / m.sales) : null,
    omzet_per_gelopen: m.gelopen > 0 ? round2(omzet / m.gelopen) : null,
    conv_ingepland_gelopen_pct: pct(m.gelopen, m.ingepland),
    conv_gelopen_sale_pct: pct(m.sales, m.gelopen),
    conv_ingepland_sale_pct: pct(m.sales, m.ingepland),
  };
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

function ymdFromIso(iso: string): string {
  return formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "yyyy-MM-dd");
}

function inYmdRange(ymd: string, start: string, end: string): boolean {
  return ymd >= start && ymd <= end;
}

/** Default: 12 ISO-weken t/m vandaag (Amsterdam). */
export function defaultSalesRange(now = new Date()): {
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

function isNieuwHuisbezoek(soort: string | null | undefined): boolean {
  return normalizeAfspraakSoort(soort) === "nieuw";
}

function leadStatusOf(a: AfspraakRow): string | null {
  const join = Array.isArray(a.leads) ? a.leads[0] : a.leads;
  return join?.status ?? null;
}

function hasUitkomst(
  leadId: string,
  leadStatus: string | null,
  doorgezetSaleLeadIds: Set<string>
): boolean {
  if (doorgezetSaleLeadIds.has(leadId)) return true;
  if (!leadStatus) return false;
  if (isSaleUitkomst(leadStatus as LeadStatus)) return true;
  if ((AFSPRAAK_UITKOMSTEN as readonly string[]).includes(leadStatus)) {
    return true;
  }
  if (VERVOLG_PUNT_VRIJGESTELD.has(leadStatus as LeadStatus)) return true;
  if (leadStatus === "deal") return true;
  return false;
}

function isGelopen(
  shape: {
    lead_id: string;
    status: string;
    soort: string | null;
    start_at: string;
    end_at?: string | null;
  },
  now: Date
): boolean {
  if (!afspraakBlokkeertAgenda(shape.soort)) return false;
  if (shape.status === "geannuleerd") return false;
  return afspraakIsAfgelopen(shape as Afspraak, now);
}

function isNietAfgeboekt(
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
  if (!isGelopen(shape, now)) return false;
  return !hasUitkomst(shape.lead_id, leadStatus, doorgezetSaleLeadIds);
}

type Acc = {
  ingepland: number;
  gelopen: number;
  niet_afgeboekt: number;
  sales: number;
  omzet: number;
};

function newAcc(): Acc {
  return { ingepland: 0, gelopen: 0, niet_afgeboekt: 0, sales: 0, omzet: 0 };
}

function addAcc(a: Acc, b: Acc): Acc {
  return {
    ingepland: a.ingepland + b.ingepland,
    gelopen: a.gelopen + b.gelopen,
    niet_afgeboekt: a.niet_afgeboekt + b.niet_afgeboekt,
    sales: a.sales + b.sales,
    omzet: a.omzet + b.omzet,
  };
}

function metricsToAcc(m: SalesMetrics): Acc {
  return {
    ingepland: m.ingepland,
    gelopen: m.gelopen,
    niet_afgeboekt: m.niet_afgeboekt,
    sales: m.sales,
    omzet: m.omzet,
  };
}

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
    sb.from("projecten").select("lead_id, status").in("lead_id", unique),
  ]);
  for (const o of offertes || []) {
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

export async function buildSalesRapportage(
  sb: SupabaseClient,
  startYmd: string,
  endYmd: string,
  now = new Date()
): Promise<SalesRapportage> {
  const { data: adviseursRaw, error: advErr } = await sb
    .from("adviseurs")
    .select("id, naam, actief, rol, startdatum")
    .order("naam");
  if (advErr) throw advErr;

  type AdvRow = {
    id: string;
    naam: string;
    actief?: boolean | null;
    rol?: string | null;
    startdatum?: string | null;
  };
  const allAdviseurs = (adviseursRaw || []) as AdvRow[];
  /** Namen voor alle adviseurs (ook inactief) — sales blijven zichtbaar */
  const advById = new Map(allAdviseurs.map((a) => [a.id, a.naam]));
  /** Alleen actieve planbare adviseurs voor afspraak-keten */
  const planbaarIds = allAdviseurs
    .filter((a) => a.actief !== false && isPlanbaarAdviseur(a))
    .map((a) => a.id);
  const ids = planbaarIds;

  const fromIso = fromZonedTime(
    (() => {
      const [y, m, d] = startYmd.split("-").map(Number);
      return new Date(y, m - 1, d, 0, 0, 0, 0);
    })(),
    AMSTERDAM_TZ
  ).toISOString();
  const toIso = fromZonedTime(
    (() => {
      const [y, m, d] = endYmd.split("-").map(Number);
      return new Date(y, m - 1, d, 23, 59, 59, 999);
    })(),
    AMSTERDAM_TZ
  ).toISOString();

  const empty = (): SalesRapportage => {
    const weeks = listWeekWindows(startYmd, endYmd);
    const series: SalesWeekBucket[] = weeks.map((w) => ({
      weekKey: w.weekKey,
      label: w.label,
      startYmd: w.startYmd,
      endYmd: w.endYmd,
      ...finalizeMetrics(newAcc()),
      adviseurs: [],
    }));
    const periodLabel =
      startYmd === endYmd
        ? startYmd
        : `${format(noonAmsterdamFromYmd(startYmd), "d MMM", { locale: nl })} – ${format(noonAmsterdamFromYmd(endYmd), "d MMM yyyy", { locale: nl })}`;
    return {
      startYmd,
      endYmd,
      periodLabel,
      totals: finalizeMetrics(newAcc()),
      series,
      months: [],
    };
  };

  if (ids.length === 0) return empty();

  const [afspraken, offertes] = await Promise.all([
    fetchAllRows<AfspraakRow>((fromIdx, toIdx) =>
      sb
        .from("afspraken")
        .select(
          "id, adviseur_id, lead_id, status, soort, start_at, end_at, leads(status)"
        )
        .in("adviseur_id", ids)
        .gte("start_at", fromIso)
        .lte("start_at", toIso)
        .neq("status", "geannuleerd")
        .order("start_at", { ascending: true })
        .range(fromIdx, toIdx)
    ),
    fetchAllRows<OfferteRow>((fromIdx, toIdx) =>
      sb
        .from("offertes")
        .select(
          "id, lead_id, status, ondertekend_op, subtotaal_ex_btw, leads(adviseur_id)"
        )
        .eq("status", "ondertekend")
        .not("ondertekend_op", "is", null)
        .gte("ondertekend_op", fromIso)
        .lte("ondertekend_op", toIso)
        .order("ondertekend_op", { ascending: true })
        .range(fromIdx, toIdx)
    ),
  ]);

  const periodLeadIds = afspraken
    .filter((a) => isNieuwHuisbezoek(a.soort))
    .map((a) => a.lead_id);
  const [doorgezetSaleLeadIds, geannuleerdOfferteIds] = await Promise.all([
    loadDoorgezetteSaleLeadIds(sb, periodLeadIds),
    loadGeannuleerdeOfferteIds(
      sb,
      offertes.map((o) => o.id).filter(Boolean)
    ),
  ]);

  // Fallback-adviseur per lead via nieuw huisbezoek (als lead.adviseur_id leeg is)
  const leadAdvFromAfspraak = new Map<string, string>();
  for (const a of afspraken) {
    if (!a.adviseur_id || !isNieuwHuisbezoek(a.soort)) continue;
    if (!leadAdvFromAfspraak.has(a.lead_id)) {
      leadAdvFromAfspraak.set(a.lead_id, a.adviseur_id);
    }
  }
  const offerteLeadIdsMissingAdv = [
    ...new Set(
      offertes
        .filter((o) => {
          const lj = Array.isArray(o.leads) ? o.leads[0] : o.leads;
          return !lj?.adviseur_id && !leadAdvFromAfspraak.has(o.lead_id);
        })
        .map((o) => o.lead_id)
    ),
  ];
  if (offerteLeadIdsMissingAdv.length > 0) {
    for (let i = 0; i < offerteLeadIdsMissingAdv.length; i += 200) {
      const chunk = offerteLeadIdsMissingAdv.slice(i, i + 200);
      const { data: hist } = await sb
        .from("afspraken")
        .select("lead_id, adviseur_id, start_at, soort")
        .in("lead_id", chunk)
        .neq("status", "geannuleerd")
        .order("start_at", { ascending: false });
      for (const row of hist || []) {
        const lid = row.lead_id as string;
        const aid = row.adviseur_id as string | null;
        if (!lid || !aid || leadAdvFromAfspraak.has(lid)) continue;
        if (!isNieuwHuisbezoek(row.soort as string | null)) continue;
        leadAdvFromAfspraak.set(lid, aid);
      }
    }
  }

  const weeks = listWeekWindows(startYmd, endYmd);
  const weekAcc = new Map<string, Acc>();
  const weekAdvAcc = new Map<string, Map<string, Acc>>();
  const monthAcc = new Map<string, Acc>();
  const monthAdvAcc = new Map<string, Map<string, Acc>>();
  for (const w of weeks) {
    weekAcc.set(w.weekKey, newAcc());
    weekAdvAcc.set(w.weekKey, new Map());
  }

  function ensureAdv(
    map: Map<string, Map<string, Acc>>,
    bucketKey: string,
    advId: string
  ): Acc {
    if (!map.has(bucketKey)) map.set(bucketKey, new Map());
    const inner = map.get(bucketKey)!;
    if (!inner.has(advId)) inner.set(advId, newAcc());
    return inner.get(advId)!;
  }

  function weekKeyForYmd(ymd: string): string | null {
    if (!inYmdRange(ymd, startYmd, endYmd)) return null;
    const info = schouwWeekFromDate(noonAmsterdamFromYmd(ymd));
    return schouwWeekValue(info.jaar, info.week);
  }

  function resolveSaleAdviseurId(o: OfferteRow): string {
    const leadJoin = Array.isArray(o.leads) ? o.leads[0] : o.leads;
    return (
      leadJoin?.adviseur_id?.trim() ||
      leadAdvFromAfspraak.get(o.lead_id) ||
      "__onbekend__"
    );
  }

  for (const a of afspraken) {
    if (!a.adviseur_id || !ids.includes(a.adviseur_id)) continue;
    if (!isNieuwHuisbezoek(a.soort)) continue;
    const ymd = ymdFromIso(a.start_at);
    if (!inYmdRange(ymd, startYmd, endYmd)) continue;
    const wk = weekKeyForYmd(ymd);
    if (!wk || !weekAcc.has(wk)) continue;

    const shape = {
      id: a.id,
      lead_id: a.lead_id,
      status: a.status,
      soort: a.soort,
      start_at: a.start_at,
      end_at: a.end_at,
    };
    const ls = leadStatusOf(a);
    const wa = weekAcc.get(wk)!;
    const aa = ensureAdv(weekAdvAcc, wk, a.adviseur_id);
    const mk = monthKeyFromYmd(ymd);
    if (!monthAcc.has(mk)) monthAcc.set(mk, newAcc());
    const ma = monthAcc.get(mk)!;
    const maa = ensureAdv(monthAdvAcc, mk, a.adviseur_id);

    wa.ingepland += 1;
    aa.ingepland += 1;
    ma.ingepland += 1;
    maa.ingepland += 1;

    if (isGelopen(shape, now)) {
      wa.gelopen += 1;
      aa.gelopen += 1;
      ma.gelopen += 1;
      maa.gelopen += 1;
    }
    if (isNietAfgeboekt(shape, ls, doorgezetSaleLeadIds, now)) {
      wa.niet_afgeboekt += 1;
      aa.niet_afgeboekt += 1;
      ma.niet_afgeboekt += 1;
      maa.niet_afgeboekt += 1;
    }
  }

  for (const o of offertes) {
    if (geannuleerdOfferteIds.has(o.id)) continue;
    if (!o.ondertekend_op) continue;
    const ymd = ymdFromIso(o.ondertekend_op);
    if (!inYmdRange(ymd, startYmd, endYmd)) continue;
    const wk = weekKeyForYmd(ymd);
    if (!wk || !weekAcc.has(wk)) continue;
    const aid = resolveSaleAdviseurId(o);
    const bedrag = Number(o.subtotaal_ex_btw) || 0;
    const wa = weekAcc.get(wk)!;
    const aa = ensureAdv(weekAdvAcc, wk, aid);
    const mk = monthKeyFromYmd(ymd);
    if (!monthAcc.has(mk)) monthAcc.set(mk, newAcc());
    const ma = monthAcc.get(mk)!;
    const maa = ensureAdv(monthAdvAcc, mk, aid);
    wa.sales += 1;
    wa.omzet += bedrag;
    aa.sales += 1;
    aa.omzet += bedrag;
    ma.sales += 1;
    ma.omzet += bedrag;
    maa.sales += 1;
    maa.omzet += bedrag;
  }

  function adviseurRowsFrom(
    advs: Map<string, Acc>
  ): SalesAdviseurRow[] {
    return [...advs.entries()]
      .map(([key, a]) => ({
        key,
        label:
          key === "__onbekend__"
            ? "Onbekend"
            : advById.get(key) || key,
        ...finalizeMetrics(a),
      }))
      .filter(
        (r) =>
          r.ingepland > 0 ||
          r.gelopen > 0 ||
          r.niet_afgeboekt > 0 ||
          r.sales > 0 ||
          r.omzet > 0
      )
      .sort(
        (a, b) =>
          b.omzet - a.omzet ||
          b.sales - a.sales ||
          b.ingepland - a.ingepland ||
          a.label.localeCompare(b.label, "nl")
      );
  }

  const series: SalesWeekBucket[] = weeks.map((w) => {
    const acc = weekAcc.get(w.weekKey) || newAcc();
    const advs = weekAdvAcc.get(w.weekKey) || new Map();
    return {
      weekKey: w.weekKey,
      label: w.label,
      startYmd: w.startYmd,
      endYmd: w.endYmd,
      ...finalizeMetrics(acc),
      adviseurs: adviseurRowsFrom(advs),
    };
  });

  // Maanden op kalendermaand van de gebeurtenis (niet week-start) —
  // zodat aug/sep-sales niet in de verkeerde maand of wegvallen.
  const monthKeys = [
    ...new Set([
      ...monthAcc.keys(),
      ...series.map((w) => monthKeyFromYmd(w.startYmd)),
    ]),
  ].sort((a, b) => b.localeCompare(a));

  const months: SalesMonthBucket[] = monthKeys.map((monthKey) => {
    const [y, m] = monthKey.split("-").map(Number);
    const monthStart = `${monthKey}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${monthKey}-${String(lastDay).padStart(2, "0")}`;
    const weekList = series
      .filter((w) => w.startYmd <= monthEnd && w.endYmd >= monthStart)
      .sort((a, b) => b.startYmd.localeCompare(a.startYmd));
    const sum = monthAcc.get(monthKey) || newAcc();
    return {
      monthKey,
      label: monthLabel(monthKey),
      startYmd: monthStart < startYmd ? startYmd : monthStart,
      endYmd: monthEnd > endYmd ? endYmd : monthEnd,
      ...finalizeMetrics(sum),
      weeks: weekList,
    };
  }).filter(
    (m) =>
      m.ingepland > 0 ||
      m.gelopen > 0 ||
      m.sales > 0 ||
      m.omzet > 0 ||
      m.weeks.length > 0
  );

  const totals = finalizeMetrics(
    series.reduce((s, w) => addAcc(s, metricsToAcc(w)), newAcc())
  );

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
  };
}

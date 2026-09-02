import {
  addDays,
  differenceInCalendarDays,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { STANDAARD_INSTALLATIEKOSTEN, hardwareKostenVoorRegels } from "@/lib/project-kosten";
import { factuurIsBetaald } from "@/lib/aanbetaling";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";
import type { RapportageRaw } from "@/lib/rapportage";

const TZ = "Europe/Amsterdam";

export type FinancialDateRange =
  | "this_week"
  | "last_7_days"
  | "this_month"
  | "last_30_days"
  | "this_year"
  | "all_time";

export type RapportageKostenRow = {
  datum: string;
  soort: "ad_spend" | "sales";
  bedrag: number;
  adviseur_id: string | null;
};

export type FinancialKpi = {
  value: number;
  deltaPct: number | null;
};

export type FinancialDayPoint = {
  date: string;
  label: string;
  omzet: number;
  winst: number;
  betaaldeOmzet: number;
  inkoop: number;
  projectkosten: number;
  adSpend: number;
  deals: number;
  leads: number;
  afspraken: number;
  cumOmzet: number;
  cumWinst: number;
  cumDeals: number;
  cumLeads: number;
};

export type FinancialBreakdownRow = {
  key: string;
  label: string;
  leads: number;
  afspraken: number;
  deals: number;
  omzet: number;
  winst: number;
  conversieDeal: number;
};

export type FinancialFunnelStep = {
  key: string;
  label: string;
  value: number;
  rateFromPrev: number | null;
};

export type FinancialDealBucket = {
  label: string;
  count: number;
  omzet: number;
};

export type FinancialCostSlice = {
  key: string;
  label: string;
  value: number;
  color: string;
};

export type FinancialTotals = {
  omzet: number;
  winst: number;
  betaaldeOmzet: number;
  inkoop: number;
  projectkosten: number;
  adSpend: number;
  salesKosten: number;
  totaleKosten: number;
  deals: number;
  leads: number;
  brutoAfspraken: number;
  nettoAfspraken: number;
  conversieAfspraak: number;
  conversieDeal: number;
  margePct: number;
  roiPct: number;
  cac: number;
  gemDealWaarde: number;
  uitvalPct: number;
};

export type FinancialDashboardData = {
  range: FinancialDateRange;
  rangeLabel: string;
  periodStart: string;
  periodEnd: string;
  previousStart: string;
  previousEnd: string;
  kpis: {
    omzet: FinancialKpi;
    winst: FinancialKpi;
    marge: FinancialKpi;
    betaaldeOmzet: FinancialKpi;
    roi: FinancialKpi;
    cac: FinancialKpi;
    gemDealWaarde: FinancialKpi;
    deals: FinancialKpi;
  };
  series: FinancialDayPoint[];
  weeklySeries: FinancialDayPoint[];
  totals: FinancialTotals;
  previousTotals: FinancialTotals;
  funnel: FinancialFunnelStep[];
  byLander: FinancialBreakdownRow[];
  byAdviseur: FinancialBreakdownRow[];
  costMix: FinancialCostSlice[];
  dealBuckets: FinancialDealBucket[];
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function inRange(iso: string, start: Date, end: Date) {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function inDateRange(dateStr: string, start: Date, end: Date) {
  const d = fromZonedTime(`${dateStr}T12:00:00`, TZ);
  return d >= start && d <= end;
}

function amsStartOfDay(d: Date): Date {
  const z = toZonedTime(d, TZ);
  return fromZonedTime(
    new Date(z.getFullYear(), z.getMonth(), z.getDate(), 0, 0, 0, 0),
    TZ
  );
}

function amsEndOfDay(d: Date): Date {
  const z = toZonedTime(d, TZ);
  return fromZonedTime(
    new Date(z.getFullYear(), z.getMonth(), z.getDate(), 23, 59, 59, 999),
    TZ
  );
}

function factuurBetaalIso(f: {
  status: string;
  betaald_op: string | null;
  factuurdatum: string;
}): string | null {
  if (f.status === "concept" || f.status === "vervallen") return null;
  if (!factuurIsBetaald(f.status, f.betaald_op)) return null;
  const raw = f.betaald_op || f.factuurdatum;
  if (!raw) return null;
  if (raw.length <= 10) return `${raw}T12:00:00+02:00`;
  return raw;
}

function afspraakIngeplandAt(a: {
  created_at?: string | null;
  start_at: string;
}): string {
  return a.created_at || a.start_at;
}

function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) {
    if (current === 0) return null;
    return 100;
  }
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

function kpi(current: number, previous: number): FinancialKpi {
  return { value: round2(current), deltaPct: deltaPct(current, previous) };
}

export function financialRangeLabel(range: FinancialDateRange): string {
  const labels: Record<FinancialDateRange, string> = {
    this_week: "Deze week",
    last_7_days: "Afgelopen 7 dagen",
    this_month: "Deze maand",
    last_30_days: "Afgelopen 30 dagen",
    this_year: "Dit jaar",
    all_time: "Alles",
  };
  return labels[range];
}

export function resolveFinancialRange(
  range: FinancialDateRange,
  now = new Date()
): { start: Date; end: Date; previousStart: Date; previousEnd: Date } {
  const end = amsEndOfDay(now);
  const z = toZonedTime(now, TZ);
  let start: Date;

  switch (range) {
    case "this_week":
      start = amsStartOfDay(startOfWeek(z, { weekStartsOn: 1 }));
      break;
    case "last_7_days":
      start = amsStartOfDay(addDays(z, -6));
      break;
    case "this_month":
      start = amsStartOfDay(startOfMonth(z));
      break;
    case "last_30_days":
      start = amsStartOfDay(addDays(z, -29));
      break;
    case "this_year":
      start = amsStartOfDay(startOfYear(z));
      break;
    case "all_time":
      start = amsStartOfDay(new Date(2020, 0, 1));
      break;
    default:
      start = amsStartOfDay(addDays(z, -29));
  }

  const days = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const previousEnd = amsEndOfDay(addDays(start, -1));
  const previousStart = amsStartOfDay(addDays(previousEnd, -(days - 1)));

  return { start, end, previousStart, previousEnd };
}

type PeriodSlice = {
  omzet: number;
  betaaldeOmzet: number;
  inkoop: number;
  projectkosten: number;
  adSpend: number;
  salesKosten: number;
  deals: number;
  leads: number;
  brutoAfspraken: number;
  nettoAfspraken: number;
};

function emptySlice(): PeriodSlice {
  return {
    omzet: 0,
    betaaldeOmzet: 0,
    inkoop: 0,
    projectkosten: 0,
    adSpend: 0,
    salesKosten: 0,
    deals: 0,
    leads: 0,
    brutoAfspraken: 0,
    nettoAfspraken: 0,
  };
}

function finalizeTotals(
  slice: PeriodSlice,
  leadsForConversie: number
): FinancialTotals {
  const totaleKosten =
    slice.inkoop + slice.projectkosten + slice.adSpend + slice.salesKosten;
  const winst = slice.omzet - totaleKosten;
  const invested = slice.adSpend + slice.inkoop + slice.projectkosten;
  return {
    omzet: round2(slice.omzet),
    winst: round2(winst),
    betaaldeOmzet: round2(slice.betaaldeOmzet),
    inkoop: round2(slice.inkoop),
    projectkosten: round2(slice.projectkosten),
    adSpend: round2(slice.adSpend),
    salesKosten: round2(slice.salesKosten),
    totaleKosten: round2(totaleKosten),
    deals: slice.deals,
    leads: slice.leads,
    brutoAfspraken: slice.brutoAfspraken,
    nettoAfspraken: slice.nettoAfspraken,
    conversieAfspraak:
      leadsForConversie > 0
        ? round2((slice.nettoAfspraken / leadsForConversie) * 100)
        : 0,
    conversieDeal:
      leadsForConversie > 0
        ? round2((slice.deals / leadsForConversie) * 100)
        : 0,
    margePct:
      slice.omzet > 0 ? round2((winst / slice.omzet) * 100) : 0,
    roiPct: invested > 0 ? round2((winst / invested) * 100) : 0,
    cac: slice.deals > 0 ? round2(slice.adSpend / slice.deals) : 0,
    gemDealWaarde:
      slice.deals > 0 ? round2(slice.omzet / slice.deals) : 0,
    uitvalPct:
      slice.brutoAfspraken > 0
        ? round2(
            ((slice.brutoAfspraken - slice.nettoAfspraken) /
              slice.brutoAfspraken) *
              100
          )
        : 0,
  };
}

function computePeriodSlice(
  raw: RapportageRaw,
  kosten: RapportageKostenRow[],
  adviseurId: string | null,
  start: Date,
  end: Date
): { slice: PeriodSlice; leadsForConversie: number } {
  const leads = adviseurId
    ? raw.leads.filter((l) => l.adviseur_id === adviseurId)
    : raw.leads;
  const afspraken = (adviseurId
    ? raw.afspraken.filter((a) => a.adviseur_id === adviseurId)
    : raw.afspraken
  ).filter((a) => afspraakBlokkeertAgenda(a.soort));
  const offertes = adviseurId
    ? raw.offertes.filter((o) => o.adviseur_id === adviseurId)
    : raw.offertes;
  const projecten = adviseurId
    ? raw.projecten.filter((p) => p.adviseur_id === adviseurId)
    : raw.projecten;
  const facturen = adviseurId
    ? (raw.facturen || []).filter((f) => f.adviseur_id === adviseurId)
    : raw.facturen || [];

  const signed = offertes.filter(
    (o) => o.status === "ondertekend" && o.ondertekend_op
  );

  const slice = emptySlice();
  let leadsForConversie = 0;

  for (const l of leads) {
    if (!inRange(l.created_at, start, end)) continue;
    slice.leads += 1;
    leadsForConversie += 1;
  }

  for (const a of afspraken) {
    if (!inRange(afspraakIngeplandAt(a), start, end)) continue;
    slice.brutoAfspraken += 1;
    if (a.status !== "geannuleerd") slice.nettoAfspraken += 1;
  }

  for (const o of signed) {
    if (!inRange(o.ondertekend_op!, start, end)) continue;
    slice.deals += 1;
    slice.omzet += Number(o.subtotaal_ex_btw) || 0;
    const project = projecten.find((p) => p.offerte_id === o.id);
    const pk = Number(project?.projectkosten) || 0;
    slice.projectkosten += pk > 0 ? pk : STANDAARD_INSTALLATIEKOSTEN;
    slice.inkoop += hardwareKostenVoorRegels(o.regels || []).totaal;
  }

  for (const f of facturen) {
    const iso = factuurBetaalIso(f);
    if (!iso || !inRange(iso, start, end)) continue;
    slice.betaaldeOmzet += Number(f.bedrag_ex_btw) || 0;
  }

  for (const k of kosten) {
    if (adviseurId && k.adviseur_id && k.adviseur_id !== adviseurId) continue;
    if (!inDateRange(k.datum, start, end)) continue;
    if (k.soort === "ad_spend") slice.adSpend += k.bedrag;
    else slice.salesKosten += k.bedrag;
  }

  return { slice, leadsForConversie };
}

function buildDailySeries(
  raw: RapportageRaw,
  kosten: RapportageKostenRow[],
  adviseurId: string | null,
  start: Date,
  end: Date
): FinancialDayPoint[] {
  const out: FinancialDayPoint[] = [];
  let cursor = amsStartOfDay(start);
  const endDay = amsEndOfDay(end);
  let cumOmzet = 0;
  let cumWinst = 0;
  let cumDeals = 0;
  let cumLeads = 0;

  while (cursor <= endDay) {
    const dayEnd = amsEndOfDay(cursor);
    const { slice } = computePeriodSlice(
      raw,
      kosten,
      adviseurId,
      cursor,
      dayEnd
    );
    const totaleKosten =
      slice.inkoop +
      slice.projectkosten +
      slice.adSpend +
      slice.salesKosten;
    const omzet = round2(slice.omzet);
    const winst = round2(slice.omzet - totaleKosten);
    cumOmzet = round2(cumOmzet + omzet);
    cumWinst = round2(cumWinst + winst);
    cumDeals += slice.deals;
    cumLeads += slice.leads;
    const dateKey = formatInTimeZone(cursor, TZ, "yyyy-MM-dd");
    out.push({
      date: dateKey,
      label: formatInTimeZone(cursor, TZ, "d MMM", { locale: nl }),
      omzet,
      winst,
      betaaldeOmzet: round2(slice.betaaldeOmzet),
      inkoop: round2(slice.inkoop),
      projectkosten: round2(slice.projectkosten),
      adSpend: round2(slice.adSpend + slice.salesKosten),
      deals: slice.deals,
      leads: slice.leads,
      afspraken: slice.nettoAfspraken,
      cumOmzet,
      cumWinst,
      cumDeals,
      cumLeads,
    });
    cursor = amsStartOfDay(addDays(cursor, 1));
  }

  return out;
}

function aggregateWeekly(series: FinancialDayPoint[]): FinancialDayPoint[] {
  if (series.length <= 14) return series;
  const weeks: FinancialDayPoint[] = [];
  for (let i = 0; i < series.length; i += 7) {
    const chunk = series.slice(i, i + 7);
    const last = chunk[chunk.length - 1];
    weeks.push({
      date: chunk[0].date,
      label: `${chunk[0].label}–${last.label}`,
      omzet: round2(chunk.reduce((s, d) => s + d.omzet, 0)),
      winst: round2(chunk.reduce((s, d) => s + d.winst, 0)),
      betaaldeOmzet: round2(chunk.reduce((s, d) => s + d.betaaldeOmzet, 0)),
      inkoop: round2(chunk.reduce((s, d) => s + d.inkoop, 0)),
      projectkosten: round2(chunk.reduce((s, d) => s + d.projectkosten, 0)),
      adSpend: round2(chunk.reduce((s, d) => s + d.adSpend, 0)),
      deals: chunk.reduce((s, d) => s + d.deals, 0),
      leads: chunk.reduce((s, d) => s + d.leads, 0),
      afspraken: chunk.reduce((s, d) => s + d.afspraken, 0),
      cumOmzet: last.cumOmzet,
      cumWinst: last.cumWinst,
      cumDeals: last.cumDeals,
      cumLeads: last.cumLeads,
    });
  }
  return weeks;
}

function buildFunnel(totals: FinancialTotals): FinancialFunnelStep[] {
  const steps = [
    { key: "leads", label: "Leads", value: totals.leads },
    { key: "afspraken", label: "Afspraken (netto)", value: totals.nettoAfspraken },
    { key: "deals", label: "Deals", value: totals.deals },
  ];
  return steps.map((s, i) => ({
    ...s,
    rateFromPrev:
      i === 0
        ? null
        : steps[i - 1].value > 0
          ? round2((s.value / steps[i - 1].value) * 100)
          : 0,
  }));
}

function buildCostMix(totals: FinancialTotals): FinancialCostSlice[] {
  return [
    { key: "inkoop", label: "Inkoop", value: totals.inkoop, color: "#ef4444" },
    {
      key: "installatie",
      label: "Installatie",
      value: totals.projectkosten,
      color: "#f97316",
    },
    { key: "ads", label: "Ad spend", value: totals.adSpend, color: "#8b5cf6" },
    {
      key: "sales",
      label: "Sales kosten",
      value: totals.salesKosten,
      color: "#64748b",
    },
    {
      key: "winst",
      label: "Winst",
      value: Math.max(0, totals.winst),
      color: "#1a8a3e",
    },
  ].filter((s) => s.value > 0);
}

function buildDealBuckets(
  raw: RapportageRaw,
  adviseurId: string | null,
  start: Date,
  end: Date
): FinancialDealBucket[] {
  const offertes = adviseurId
    ? raw.offertes.filter((o) => o.adviseur_id === adviseurId)
    : raw.offertes;
  const buckets = [
    { label: "< €5k", min: 0, max: 5000, count: 0, omzet: 0 },
    { label: "€5–8k", min: 5000, max: 8000, count: 0, omzet: 0 },
    { label: "€8–12k", min: 8000, max: 12000, count: 0, omzet: 0 },
    { label: "€12k+", min: 12000, max: Infinity, count: 0, omzet: 0 },
  ];
  for (const o of offertes) {
    if (o.status !== "ondertekend" || !o.ondertekend_op) continue;
    if (!inRange(o.ondertekend_op, start, end)) continue;
    const v = Number(o.subtotaal_ex_btw) || 0;
    const b = buckets.find((x) => v >= x.min && v < x.max) || buckets[3];
    b.count += 1;
    b.omzet += v;
  }
  return buckets.map((b) => ({
    label: b.label,
    count: b.count,
    omzet: round2(b.omzet),
  }));
}

function buildBreakdowns(
  raw: RapportageRaw,
  adviseurId: string | null,
  start: Date,
  end: Date
): { byLander: FinancialBreakdownRow[]; byAdviseur: FinancialBreakdownRow[] } {
  const leads = adviseurId
    ? raw.leads.filter((l) => l.adviseur_id === adviseurId)
    : raw.leads;
  const leadMap = new Map(leads.map((l) => [l.id, l]));
  const afspraakLeadIds = new Set<string>();
  for (const a of raw.afspraken) {
    if (!leadMap.has(a.lead_id)) continue;
    if (!afspraakBlokkeertAgenda(a.soort)) continue;
    if (a.status === "geannuleerd") continue;
    if (!inRange(afspraakIngeplandAt(a), start, end)) continue;
    afspraakLeadIds.add(a.lead_id);
  }

  type Acc = {
    leads: Set<string>;
    afspraken: Set<string>;
    deals: number;
    omzet: number;
    inkoop: number;
    projectkosten: number;
  };
  const byLander = new Map<string, Acc>();
  const byAdv = new Map<string, Acc>();

  function ensure(map: Map<string, Acc>, key: string): Acc {
    let a = map.get(key);
    if (!a) {
      a = {
        leads: new Set(),
        afspraken: new Set(),
        deals: 0,
        omzet: 0,
        inkoop: 0,
        projectkosten: 0,
      };
      map.set(key, a);
    }
    return a;
  }

  for (const l of leads) {
    if (!inRange(l.created_at, start, end)) continue;
    const lander = (l.lander || "").trim() || "(geen lander)";
    const adv = l.adviseur_id || "(geen adviseur)";
    ensure(byLander, lander).leads.add(l.id);
    ensure(byAdv, adv).leads.add(l.id);
    if (afspraakLeadIds.has(l.id)) {
      ensure(byLander, lander).afspraken.add(l.id);
      ensure(byAdv, adv).afspraken.add(l.id);
    }
  }

  const projecten = adviseurId
    ? raw.projecten.filter((p) => p.adviseur_id === adviseurId)
    : raw.projecten;
  const offertes = adviseurId
    ? raw.offertes.filter((o) => o.adviseur_id === adviseurId)
    : raw.offertes;

  for (const o of offertes) {
    if (o.status !== "ondertekend" || !o.ondertekend_op) continue;
    if (!inRange(o.ondertekend_op, start, end)) continue;
    const lead = leadMap.get(o.lead_id);
    const lander = (lead?.lander || "").trim() || "(geen lander)";
    const adv =
      o.adviseur_id || lead?.adviseur_id || "(geen adviseur)";
    const project = projecten.find((p) => p.offerte_id === o.id);
    const pk = Number(project?.projectkosten) || 0;
    const inkoop = hardwareKostenVoorRegels(o.regels || []).totaal;
    const omzet = Number(o.subtotaal_ex_btw) || 0;
    for (const [map, key] of [
      [byLander, lander] as const,
      [byAdv, adv] as const,
    ]) {
      const acc = ensure(map, key);
      acc.deals += 1;
      acc.omzet += omzet;
      acc.inkoop += inkoop;
      acc.projectkosten += pk > 0 ? pk : STANDAARD_INSTALLATIEKOSTEN;
    }
  }

  function toRows(map: Map<string, Acc>): FinancialBreakdownRow[] {
    return [...map.entries()]
      .map(([key, a]) => {
        const winst = a.omzet - a.inkoop - a.projectkosten;
        return {
          key,
          label: key,
          leads: a.leads.size,
          afspraken: a.afspraken.size,
          deals: a.deals,
          omzet: round2(a.omzet),
          winst: round2(winst),
          conversieDeal:
            a.leads.size > 0
              ? round2((a.deals / a.leads.size) * 100)
              : 0,
        };
      })
      .sort((a, b) => b.omzet - a.omzet || b.leads - a.leads)
      .slice(0, 12);
  }

  return { byLander: toRows(byLander), byAdviseur: toRows(byAdv) };
}

export function buildFinancialDashboard(
  raw: RapportageRaw,
  kosten: RapportageKostenRow[],
  adviseurId: string | null,
  range: FinancialDateRange,
  now = new Date()
): FinancialDashboardData {
  const { start, end, previousStart, previousEnd } = resolveFinancialRange(
    range,
    now
  );

  const current = computePeriodSlice(raw, kosten, adviseurId, start, end);
  const previous = computePeriodSlice(
    raw,
    kosten,
    adviseurId,
    previousStart,
    previousEnd
  );

  const totals = finalizeTotals(current.slice, current.leadsForConversie);
  const previousTotals = finalizeTotals(
    previous.slice,
    previous.leadsForConversie
  );
  const series = buildDailySeries(raw, kosten, adviseurId, start, end);
  const { byLander, byAdviseur } = buildBreakdowns(
    raw,
    adviseurId,
    start,
    end
  );

  return {
    range,
    rangeLabel: financialRangeLabel(range),
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    previousStart: previousStart.toISOString(),
    previousEnd: previousEnd.toISOString(),
    kpis: {
      omzet: kpi(totals.omzet, previousTotals.omzet),
      winst: kpi(totals.winst, previousTotals.winst),
      marge: kpi(totals.margePct, previousTotals.margePct),
      betaaldeOmzet: kpi(totals.betaaldeOmzet, previousTotals.betaaldeOmzet),
      roi: kpi(totals.roiPct, previousTotals.roiPct),
      cac: kpi(totals.cac, previousTotals.cac),
      gemDealWaarde: kpi(totals.gemDealWaarde, previousTotals.gemDealWaarde),
      deals: kpi(totals.deals, previousTotals.deals),
    },
    series,
    weeklySeries: aggregateWeekly(series),
    totals,
    previousTotals,
    funnel: buildFunnel(totals),
    byLander,
    byAdviseur,
    costMix: buildCostMix(totals),
    dealBuckets: buildDealBuckets(raw, adviseurId, start, end),
  };
}

export function parseFinancialRange(
  value: string | null
): FinancialDateRange {
  const allowed: FinancialDateRange[] = [
    "this_week",
    "last_7_days",
    "this_month",
    "last_30_days",
    "this_year",
    "all_time",
  ];
  if (value && allowed.includes(value as FinancialDateRange)) {
    return value as FinancialDateRange;
  }
  return "last_30_days";
}

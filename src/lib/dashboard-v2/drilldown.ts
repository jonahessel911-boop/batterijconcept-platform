import {
  DASHBOARD_V2_PERIOD_LABELS,
  afsprakenVoorL2a,
  afsprakenVoltooidInRange,
  amsDayKey,
  buildBucketDefsForRange,
  dealAt,
  isEersteNieuwAfspraak,
  resolveDashboardV2Range,
  type DashboardV2Raw,
  type Range,
} from "./build";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";
import { inIsoRange, round2, safeDiv } from "@/lib/management-dashboard/periods";
import {
  formatSchouwWeekLabel,
  schouwWeekFromDate,
} from "@/lib/schouw-week";
import { differenceInCalendarDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  parseWeeklyGoals,
  scaleWeeklyGoalsByDays,
  type DashboardV2Goals,
} from "./goals";
import type { DashboardV2Period, DashboardV2RangeOpts } from "./types";

const TZ = "Europe/Amsterdam";

export type DashboardV2Kpi =
  | "leads"
  | "orders"
  | "leadToAppt"
  | "afspraakToSale"
  | "afsprakenGepland"
  | "omzet"
  | "annuleringen"
  | "sales";

export const DASHBOARD_V2_KPI_LABELS: Record<DashboardV2Kpi, string> = {
  leads: "Leads",
  orders: "Orders",
  leadToAppt: "Lead → afspraak",
  afspraakToSale: "Afspraak → sale",
  afsprakenGepland: "Afspraken gepland",
  omzet: "Omzet",
  annuleringen: "Annuleringen",
  sales: "Omzet per sales",
};

export type DrilldownDay = {
  key: string;
  label: string;
  start: string;
  end: string;
  leads: number;
  afsprakenGepland: number;
  /** Eerste nieuw-afspraak per lead (zonder heringepland) */
  eersteAfspraken: number;
  afsprakenVoltooid: number;
  leadToAppt: number | null;
  afspraakToSale: number | null;
  orders: number;
  omzet: number;
  annuleringen: number;
  verlorenOmzet?: number;
};

export type DrilldownRow = {
  id: string;
  at: string;
  dayKey: string;
  titel: string;
  subtitel: string;
  meta: string | null;
  waarde: number | null;
  waardeLabel: string | null;
  /** Persoonlijk/rij-doel (bijv. omzet per adviseur) */
  doel: number | null;
  href: string;
  adviseur: string | null;
};

export type DashboardV2Drilldown = {
  kpi: DashboardV2Kpi;
  title: string;
  period: DashboardV2Period;
  periodLabel: string;
  rangeStart: string;
  rangeEnd: string;
  fromDate: string;
  toDate: string;
  dayCount: number;
  granularity: "day" | "week" | "month";
  actual: number;
  goal: number;
  actualLabel: string;
  goalLabel: string;
  /**
   * Doel voor de grafiekstaven (per bucket te verdelen tenzij rateGoal).
   * Bij L2A = afspraakendoel (staven = afspraken), niet het %-doel.
   */
  chartGoal: number;
  /** true = zelfde doel% per bucket (ratio-KPI) */
  rateGoal: boolean;
  /** Extra totals for L2A / A2S context */
  extras?: {
    leads: number;
    afsprakenGepland: number;
    afsprakenVoltooid?: number;
    orders?: number;
  };
  days: DrilldownDay[];
  rows: DrilldownRow[];
  rowKind: "leads" | "afspraken" | "orders" | "sales";
};

export type DrilldownRaw = {
  leads: {
    id: string;
    created_at: string;
    naam: string | null;
    lead_number: string | null;
    status: string | null;
    telefoon: string | null;
    plaats: string | null;
    adviseur_id?: string | null;
  }[];
  afspraken: {
    id: string;
    lead_id: string;
    adviseur_id: string | null;
    start_at: string;
    end_at?: string | null;
    created_at: string | null;
    status: string;
    soort: string | null;
    lead_naam: string | null;
    lead_number: string | null;
    lead_plaats: string | null;
    lead_status: string | null;
  }[];
  offertes: {
    id: string;
    lead_id: string;
    adviseur_id: string | null;
    ondertekend_op: string | null;
    created_at: string;
    subtotaal_ex_btw: number;
    offerte_nummer: string | null;
    lead_naam: string | null;
    lead_number: string | null;
    geannuleerd?: boolean;
  }[];
  adviseurs: {
    id: string;
    naam: string;
    actief: boolean;
    rol: string | null;
    email?: string | null;
  }[];
};

export function parseDashboardV2Kpi(v: string | null): DashboardV2Kpi | null {
  if (
    v === "leads" ||
    v === "orders" ||
    v === "leadToAppt" ||
    v === "afspraakToSale" ||
    v === "afsprakenGepland" ||
    v === "omzet" ||
    v === "annuleringen" ||
    v === "sales"
  ) {
    return v;
  }
  return null;
}

function fmtMoney(n: number): string {
  return `€${n.toLocaleString("nl-NL", { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number): string {
  return `${n.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
}

function adviseurNaam(raw: DrilldownRaw, id: string | null): string | null {
  if (!id) return null;
  return raw.adviseurs.find((a) => a.id === id)?.naam || null;
}

function toBuildRaw(raw: DrilldownRaw): DashboardV2Raw {
  return {
    leads: raw.leads.map((l) => ({
      id: l.id,
      created_at: l.created_at,
      adviseur_id: l.adviseur_id ?? null,
      status: l.status ?? null,
    })),
    afspraken: raw.afspraken.map((a) => ({
      id: a.id,
      lead_id: a.lead_id,
      adviseur_id: a.adviseur_id,
      start_at: a.start_at,
      created_at: a.created_at,
      status: a.status,
      soort: a.soort,
    })),
    offertes: raw.offertes.map((o) => ({
      id: o.id,
      lead_id: o.lead_id,
      adviseur_id: o.adviseur_id,
      ondertekend_op: o.ondertekend_op,
      created_at: o.created_at,
      subtotaal_ex_btw: o.subtotaal_ex_btw,
      geannuleerd: Boolean(o.geannuleerd),
    })),
    adviseurs: raw.adviseurs,
  };
}

function buildSeries(
  raw: DrilldownRaw,
  range: Range,
  now = new Date()
): { granularity: DashboardV2Drilldown["granularity"]; days: DrilldownDay[] } {
  const { granularity, buckets } = buildBucketDefsForRange(range);
  const leadStatusById = new Map(
    raw.leads.map((l) => [l.id, l.status ?? null] as const)
  );
  const days = buckets.map((d) => {
    const leads = raw.leads.filter((l) =>
      inIsoRange(l.created_at, d.start, d.end)
    ).length;
    const afsprakenGepland = raw.afspraken.filter((a) => {
      if (!afspraakBlokkeertAgenda(a.soort)) return false;
      const at = a.created_at || a.start_at;
      return inIsoRange(at, d.start, d.end);
    }).length;
    const eersteAfspraken = afsprakenVoorL2a(raw.afspraken, {
      start: d.start,
      end: d.end,
    }).length;
    const afsprakenVoltooid = afsprakenVoltooidInRange(
      raw.afspraken,
      { start: d.start, end: d.end },
      now,
      leadStatusById
    ).length;
    let orders = 0;
    let omzet = 0;
    let annuleringen = 0;
    let verlorenOmzet = 0;
    for (const o of raw.offertes) {
      const at = dealAt(o);
      if (!at || !inIsoRange(at, d.start, d.end)) continue;
      if (o.geannuleerd) {
        annuleringen += 1;
        verlorenOmzet += Number(o.subtotaal_ex_btw) || 0;
        continue;
      }
      orders += 1;
      omzet += Number(o.subtotaal_ex_btw) || 0;
    }
    const l2a = safeDiv(eersteAfspraken, leads);
    const a2s = safeDiv(orders, afsprakenVoltooid);
    return {
      key: d.key,
      label: d.label,
      start: d.start.toISOString(),
      end: d.end.toISOString(),
      leads,
      afsprakenGepland,
      eersteAfspraken,
      afsprakenVoltooid,
      leadToAppt: l2a != null ? round2(l2a * 100) : null,
      afspraakToSale: a2s != null ? round2(a2s * 100) : null,
      orders,
      omzet: round2(omzet),
      annuleringen,
      verlorenOmzet: round2(verlorenOmzet),
    };
  });
  return { granularity, days };
}

function leadRows(raw: DrilldownRaw, range: Range): DrilldownRow[] {
  return raw.leads
    .filter((l) => inIsoRange(l.created_at, range.start, range.end))
    .map((l) => ({
      id: l.id,
      at: l.created_at,
      dayKey: amsDayKey(l.created_at),
      titel: l.naam || "—",
      subtitel: l.lead_number || l.id.slice(0, 8),
      meta: [l.status, l.plaats, l.telefoon].filter(Boolean).join(" · ") || null,
      waarde: null,
      waardeLabel: null,
      doel: null,
      href: `/?tab=leads&lead=${l.id}`,
      adviseur: null,
    }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function afspraakRows(
  raw: DrilldownRaw,
  range: Range,
  opts: { alleenEersteNieuw?: boolean; alleenVoltooid?: boolean } = {}
): DrilldownRow[] {
  const now = new Date();
  const leadStatusById = new Map(
    raw.leads.map((l) => [l.id, l.status ?? null] as const)
  );
  const afgeboektIds = opts.alleenVoltooid
    ? new Set(
        afsprakenVoltooidInRange(
          raw.afspraken,
          range,
          now,
          leadStatusById
        ).map((a) => a.id)
      )
    : null;
  return raw.afspraken
    .filter((a) => {
      if (opts.alleenVoltooid) {
        return afgeboektIds?.has(a.id) ?? false;
      }
      if (opts.alleenEersteNieuw) {
        if (!isEersteNieuwAfspraak(a, raw.afspraken)) return false;
      } else if (!afspraakBlokkeertAgenda(a.soort)) {
        return false;
      }
      const at = a.created_at || a.start_at;
      return inIsoRange(at, range.start, range.end);
    })
    .map((a) => {
      const at = opts.alleenVoltooid
        ? a.start_at
        : a.created_at || a.start_at;
      const leadStatus = a.lead_status || leadStatusById.get(a.lead_id) || null;
      return {
        id: a.id,
        at,
        dayKey: amsDayKey(at),
        titel: a.lead_naam || "—",
        subtitel: a.lead_number || a.lead_id.slice(0, 8),
        meta: [
          opts.alleenVoltooid ? "Doorgegaan · afgeboekt" : a.status,
          a.soort,
          `bezoek ${formatInTimeZone(new Date(a.start_at), TZ, "d MMM HH:mm")}`,
          leadStatus,
          a.lead_plaats,
        ]
          .filter(Boolean)
          .join(" · "),
        waarde: null,
        waardeLabel: null,
        doel: null,
        href: `/?tab=leads&lead=${a.lead_id}`,
        adviseur: adviseurNaam(raw, a.adviseur_id),
      };
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function orderRows(
  raw: DrilldownRaw,
  range: Range,
  opts: { alleenGeannuleerd?: boolean } = {}
): DrilldownRow[] {
  return raw.offertes
    .filter((o) => {
      const at = dealAt(o);
      if (!at || !inIsoRange(at, range.start, range.end)) return false;
      if (opts.alleenGeannuleerd) return Boolean(o.geannuleerd);
      return !o.geannuleerd;
    })
    .map((o) => {
      const at = dealAt(o)!;
      const omzet = Number(o.subtotaal_ex_btw) || 0;
      return {
        id: o.id,
        at,
        dayKey: amsDayKey(at),
        titel: o.lead_naam || "—",
        subtitel: o.offerte_nummer || o.lead_number || o.id.slice(0, 8),
        meta: o.geannuleerd ? "Geannuleerd" : null,
        waarde: omzet,
        waardeLabel: fmtMoney(omzet),
        doel: null,
        href: `/?tab=leads&lead=${o.lead_id}`,
        adviseur: adviseurNaam(raw, o.adviseur_id),
      };
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function salesRows(
  raw: DrilldownRaw,
  range: Range,
  goals: DashboardV2Goals
): DrilldownRow[] {
  const byId = new Map<
    string,
    { naam: string; omzet: number; orders: number }
  >();
  for (const a of raw.adviseurs) {
    const rol = (a.rol || "adviseur").toLowerCase();
    if (!a.actief && rol !== "adviseur" && rol !== "admin") continue;
    if (rol === "adviseur" || rol === "admin") {
      byId.set(a.id, { naam: a.naam, omzet: 0, orders: 0 });
    }
  }
  for (const o of raw.offertes) {
    const at = dealAt(o);
    if (!at || !inIsoRange(at, range.start, range.end)) continue;
    if (o.geannuleerd) continue;
    if (!o.adviseur_id) continue;
    const row = byId.get(o.adviseur_id) || {
      naam: adviseurNaam(raw, o.adviseur_id) || "Onbekend",
      omzet: 0,
      orders: 0,
    };
    row.omzet += Number(o.subtotaal_ex_btw) || 0;
    row.orders += 1;
    byId.set(o.adviseur_id, row);
  }
  return [...byId.entries()]
    .map(([id, r]) => {
      const goal = goals.omzetPerAdviseur?.[id] || goals.omzet || 0;
      const pct =
        goal > 0 ? Math.round((r.omzet / goal) * 1000) / 10 : null;
      return {
        id,
        at: range.end.toISOString(),
        dayKey: "",
        titel: r.naam,
        subtitel: `${r.orders} orders`,
        meta: goal
          ? `Doel ${fmtMoney(goal)}${pct != null ? ` · ${pct}%` : ""}`
          : null,
        waarde: r.omzet,
        waardeLabel: fmtMoney(r.omzet),
        doel: goal > 0 ? goal : null,
        href: `/?tab=rapportage`,
        adviseur: r.naam,
      };
    })
    .filter((r) => (r.waarde || 0) > 0 || (r.meta && r.meta.includes("Doel")))
    .sort((a, b) => (b.waarde || 0) - (a.waarde || 0));
}

function periodLabelFor(
  period: DashboardV2Period,
  range: Range,
  dayCount: number
): string {
  if (period === "calendar_week") {
    const { jaar, week } = schouwWeekFromDate(range.start);
    return formatSchouwWeekLabel(jaar, week);
  }
  if (period === "this_month" || period === "custom" || period === "all") {
    const a = formatInTimeZone(range.start, TZ, "d MMM yyyy");
    const b = formatInTimeZone(range.end, TZ, "d MMM yyyy");
    return period === "this_month"
      ? `Deze maand · ${a} – ${b}`
      : `${a} – ${b} (${dayCount}d)`;
  }
  return DASHBOARD_V2_PERIOD_LABELS[period];
}

export function buildDashboardV2Drilldown(
  raw: DrilldownRaw,
  period: DashboardV2Period,
  kpi: DashboardV2Kpi,
  goalsRaw: unknown = null,
  rangeOpts: DashboardV2RangeOpts = {}
): DashboardV2Drilldown {
  const range = resolveDashboardV2Range(
    period,
    new Date(),
    rangeOpts,
    toBuildRaw(raw)
  );
  const dayCount = Math.max(
    1,
    differenceInCalendarDays(range.end, range.start) + 1
  );
  const goals = scaleWeeklyGoalsByDays(
    parseWeeklyGoals(
      goalsRaw,
      raw.adviseurs.map((a) => ({ id: a.id, rol: a.rol, actief: a.actief }))
    ),
    dayCount
  );
  const { granularity, days } = buildSeries(raw, range);
  const leads = days.reduce((s, d) => s + d.leads, 0);
  const afsprakenGepland = days.reduce((s, d) => s + d.afsprakenGepland, 0);
  const eersteAfspraken = days.reduce((s, d) => s + d.eersteAfspraken, 0);
  const afsprakenVoltooid = days.reduce((s, d) => s + d.afsprakenVoltooid, 0);
  const orders = days.reduce((s, d) => s + d.orders, 0);
  const omzet = round2(days.reduce((s, d) => s + d.omzet, 0));
  const annuleringen = days.reduce((s, d) => s + d.annuleringen, 0);
  const getekendTotaal = orders + annuleringen;
  const annuleringsPct =
    getekendTotaal > 0
      ? round2((annuleringen / getekendTotaal) * 100)
      : 0;
  const l2a = safeDiv(eersteAfspraken, leads);
  const leadToAppt = l2a != null ? round2(l2a * 100) : 0;
  const a2s = safeDiv(orders, afsprakenVoltooid);
  const afspraakToSale = a2s != null ? round2(a2s * 100) : 0;

  const fromDate = formatInTimeZone(range.start, TZ, "yyyy-MM-dd");
  const toDate = formatInTimeZone(range.end, TZ, "yyyy-MM-dd");

  const base = {
    kpi,
    title: DASHBOARD_V2_KPI_LABELS[kpi],
    period,
    periodLabel: periodLabelFor(period, range, dayCount),
    rangeStart: range.start.toISOString(),
    rangeEnd: range.end.toISOString(),
    fromDate,
    toDate,
    dayCount,
    granularity,
    days,
  };

  switch (kpi) {
    case "leads":
      return {
        ...base,
        actual: leads,
        goal: goals.leads,
        actualLabel: String(leads),
        goalLabel: String(goals.leads),
        chartGoal: goals.leads,
        rateGoal: false,
        rows: leadRows(raw, range),
        rowKind: "leads",
      };
    case "afsprakenGepland":
      return {
        ...base,
        actual: afsprakenGepland,
        goal: goals.afsprakenGepland,
        actualLabel: String(afsprakenGepland),
        goalLabel: String(goals.afsprakenGepland),
        chartGoal: goals.afsprakenGepland,
        rateGoal: false,
        rows: afspraakRows(raw, range),
        rowKind: "afspraken",
      };
    case "leadToAppt":
      return {
        ...base,
        actual: leadToAppt,
        goal: goals.leadToAppt,
        actualLabel: fmtPct(leadToAppt),
        goalLabel: fmtPct(goals.leadToAppt),
        chartGoal: goals.afsprakenGepland,
        rateGoal: false,
        extras: { leads, afsprakenGepland: eersteAfspraken },
        rows: afspraakRows(raw, range, { alleenEersteNieuw: true }),
        rowKind: "afspraken",
      };
    case "afspraakToSale":
      return {
        ...base,
        actual: afspraakToSale,
        goal: goals.afspraakToSale,
        actualLabel: fmtPct(afspraakToSale),
        goalLabel: fmtPct(goals.afspraakToSale),
        chartGoal: goals.afspraakToSale,
        rateGoal: true,
        extras: {
          leads: orders,
          afsprakenGepland: afsprakenVoltooid,
          afsprakenVoltooid,
          orders,
        },
        rows: afspraakRows(raw, range, { alleenVoltooid: true }),
        rowKind: "afspraken",
      };
    case "orders":
      return {
        ...base,
        actual: orders,
        goal: goals.orders,
        actualLabel: String(orders),
        goalLabel: String(goals.orders),
        chartGoal: goals.orders,
        rateGoal: false,
        rows: orderRows(raw, range),
        rowKind: "orders",
      };
    case "annuleringen":
      return {
        ...base,
        actual: annuleringsPct,
        goal: 0,
        actualLabel: `${fmtPct(annuleringsPct)} · ${annuleringen} van ${getekendTotaal}`,
        goalLabel: "—",
        chartGoal: 0,
        rateGoal: true,
        extras: {
          leads: annuleringen,
          afsprakenGepland: getekendTotaal,
          orders,
        },
        rows: orderRows(raw, range, { alleenGeannuleerd: true }),
        rowKind: "orders",
      };
    case "omzet":
      return {
        ...base,
        actual: omzet,
        goal: goals.omzet,
        actualLabel: fmtMoney(omzet),
        goalLabel: fmtMoney(goals.omzet),
        chartGoal: goals.omzet,
        rateGoal: false,
        rows: orderRows(raw, range),
        rowKind: "orders",
      };
    case "sales":
      return {
        ...base,
        actual: omzet,
        goal: goals.omzet,
        actualLabel: fmtMoney(omzet),
        goalLabel: fmtMoney(goals.omzet),
        chartGoal: goals.omzet,
        rateGoal: false,
        rows: salesRows(raw, range, goals),
        rowKind: "sales",
      };
  }
}

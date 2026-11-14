import { isAttributed, type Dossier } from "@/lib/sales-cockpit/classify";
import {
  bucketKey,
  daysInclusive,
  listBuckets,
  weekRangeContaining,
  ymdInRange,
  type DateRange,
  type GroupBy,
} from "@/lib/sales-cockpit/range";

export type Filters = {
  advisorIds: string[];
  activity: "alle" | "actief" | "historisch";
  bron: string | null;
  plannerId: string | null;
  financiering: "alle" | "warmtefonds" | "eigen_middelen" | "onbekend";
};

export type AdvisorMeta = {
  id: string;
  naam: string;
  actief: boolean;
  commissiePct: number;
};

export type Ratio = { num: number; den: number };

export type Totals = {
  advisors: number;
  assigned: number;
  gelopen: number;
  gelopenBenadering: number;
  open: number;
  openVervolg: number;
  afgeboekt: number;
  soldCohort: number;
  conversion: Ratio;
  unknownVisit: number;
  signed: number;
  signedEx: number;
  extraOrders: number;
  extraEx: number;
  deposited: number;
  depositedEx: number;
  depositNone: number;
  timely: Ratio;
  inTerm: number;
  payDaysAvg: number | null;
  payDaysN: number;
  openOver7: number;
  cancelledOfSigned: number;
  netto: number;
  nettoEx: number;
  aov: number | null;
  marginEx: number | null;
  unattributed: number;
  conflict: number;
};

export type AdvisorRow = Totals & {
  id: string;
  naam: string;
  actief: boolean;
  weeksActive: number | null;
};

export type TrendPoint = {
  key: string;
  label: string;
  gelopen: number;
  soldCohort: number;
  signed: number;
  cancelledOfSigned: number;
  conversion: Ratio;
  payDaysAvg: number | null;
};

function emptyTotals(): Totals {
  return {
    advisors: 0,
    assigned: 0,
    gelopen: 0,
    gelopenBenadering: 0,
    open: 0,
    openVervolg: 0,
    afgeboekt: 0,
    soldCohort: 0,
    conversion: { num: 0, den: 0 },
    unknownVisit: 0,
    signed: 0,
    signedEx: 0,
    extraOrders: 0,
    extraEx: 0,
    deposited: 0,
    depositedEx: 0,
    depositNone: 0,
    timely: { num: 0, den: 0 },
    inTerm: 0,
    payDaysAvg: null,
    payDaysN: 0,
    openOver7: 0,
    cancelledOfSigned: 0,
    netto: 0,
    nettoEx: 0,
    aov: null,
    marginEx: null,
    unattributed: 0,
    conflict: 0,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function applyFilters(
  rows: Dossier[],
  filters: Filters,
  advisors: Map<string, AdvisorMeta>
): { rows: Dossier[] } {
  const out = rows.filter((row) => {
    if (filters.advisorIds.length > 0) {
      if (!isAttributed(row) || !row.adviseurId) return false;
      if (!filters.advisorIds.includes(row.adviseurId)) return false;
    }
    if (filters.activity !== "alle" && row.adviseurId) {
      const adv = advisors.get(row.adviseurId);
      const active = adv ? adv.actief : true;
      if (filters.activity === "actief" && !active) return false;
      if (filters.activity === "historisch" && active) return false;
    }
    if (filters.bron && (row.bron || "") !== filters.bron) return false;
    if (filters.plannerId && row.plannerId !== filters.plannerId) return false;
    if (filters.financiering !== "alle" && row.financiering !== filters.financiering) {
      return false;
    }
    return true;
  });
  return { rows: out };
}

function gelopenIn(row: Dossier, range: DateRange): boolean {
  return row.gelopen && ymdInRange(row.conversationYmd, range);
}

export function totalsFor(rows: Dossier[], range: DateRange): Totals {
  const t = emptyTotals();
  const advisorIds = new Set<string>();
  let paySum = 0;
  let margin = 0;
  let marginN = 0;

  for (const row of rows) {
    if (ymdInRange(row.assignmentYmd, range)) {
      t.assigned += 1;
      if (!isAttributed(row)) t.unattributed += 1;
      if (row.bezoek === "onbekend") t.unknownVisit += 1;
      if (row.adviseurId) advisorIds.add(row.adviseurId);
    }
    if (gelopenIn(row, range)) {
      t.gelopen += 1;
      if (row.gelopenBenadering) t.gelopenBenadering += 1;
      if (row.stand === "open") t.open += 1;
      if (row.stand === "open_vervolg") t.openVervolg += 1;
      if (row.stand === "afgeboekt") t.afgeboekt += 1;
      if (row.stand === "sale") t.soldCohort += 1;
      t.conversion.den += 1;
      if (row.stand === "sale") t.conversion.num += 1;
      if (row.adviseurId) advisorIds.add(row.adviseurId);
    }
    if (ymdInRange(row.signedYmd, range)) {
      t.signed += 1;
      t.signedEx = round2(t.signedEx + row.signedEx);
      t.extraOrders += row.extraOrders;
      t.extraEx = round2(t.extraEx + row.extraEx);
      if (row.depositNone) t.depositNone += 1;
      if (row.depositMet && !row.cancelled) {
        t.deposited += 1;
        t.depositedEx = round2(t.depositedEx + row.signedEx);
      }
      if (row.timelyKnown != null && !row.depositNone) {
        t.timely.den += 1;
        if (row.timelyKnown) t.timely.num += 1;
      }
      if (row.inTerm) t.inTerm += 1;
      if (row.payDays != null) {
        paySum += row.payDays;
        t.payDaysN += 1;
      }
      if (row.openOver7) t.openOver7 += 1;
      if (row.cancelled) t.cancelledOfSigned += 1;
      if (row.conflict) t.conflict += 1;
      if (row.marginEx != null && !row.cancelled) {
        margin += row.marginEx;
        marginN += 1;
      }
      if (row.adviseurId) advisorIds.add(row.adviseurId);
    }
    if (row.netto && ymdInRange(row.nettoYmd, range)) {
      t.netto += 1;
      t.nettoEx = round2(t.nettoEx + row.signedEx);
    }
  }

  t.advisors = advisorIds.size;
  t.payDaysAvg = t.payDaysN > 0 ? round1(paySum / t.payDaysN) : null;
  t.aov = t.signed > 0 ? round2(t.signedEx / t.signed) : null;
  t.marginEx = marginN > 0 ? round2(margin) : null;
  t.signedEx = round2(t.signedEx);
  t.depositedEx = round2(t.depositedEx);
  t.nettoEx = round2(t.nettoEx);
  return t;
}

export function perDay(totals: Totals, range: DateRange): { assigned: number; gelopen: number; signed: number } | null {
  const days = daysInclusive(range.from, range.to);
  if (days <= 0) return null;
  return {
    assigned: round1(totals.assigned / days),
    gelopen: round1(totals.gelopen / days),
    signed: round1(totals.signed / days),
  };
}

export function advisorRows(
  rows: Dossier[],
  range: DateRange,
  advisors: Map<string, AdvisorMeta>
): AdvisorRow[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!isAttributed(row) || !row.adviseurId) continue;
    if (
      ymdInRange(row.assignmentYmd, range) ||
      gelopenIn(row, range) ||
      ymdInRange(row.signedYmd, range) ||
      (row.netto && ymdInRange(row.nettoYmd, range))
    ) {
      ids.add(row.adviseurId);
    }
  }
  return [...ids].map((id) => {
    const meta = advisors.get(id);
    const mine = rows.filter((r) => r.adviseurId === id && isAttributed(r));
    const totals = totalsFor(mine, range);
    let weeksActive: number | null = null;
    if (meta?.actief === false) weeksActive = null;
    return {
      id,
      naam: meta?.naam || "Onbekend",
      actief: meta ? meta.actief : true,
      weeksActive,
      ...totals,
      advisors: 1,
    };
  });
}

export function trendFor(rows: Dossier[], range: DateRange, group: GroupBy): TrendPoint[] {
  const buckets = listBuckets(range, group);
  return buckets.map((b) => {
    let gelopen = 0;
    let soldCohort = 0;
    let signed = 0;
    let cancelled = 0;
    let paySum = 0;
    let payN = 0;
    for (const row of rows) {
      if (row.gelopen && row.conversationYmd && bucketKey(row.conversationYmd, group) === b.key && ymdInRange(row.conversationYmd, range)) {
        gelopen += 1;
        if (row.stand === "sale") soldCohort += 1;
      }
      if (row.signedYmd && bucketKey(row.signedYmd, group) === b.key && ymdInRange(row.signedYmd, range)) {
        signed += 1;
        if (row.cancelled) cancelled += 1;
        if (row.payDays != null) {
          paySum += row.payDays;
          payN += 1;
        }
      }
    }
    return {
      key: b.key,
      label: b.label,
      gelopen,
      soldCohort,
      signed,
      cancelledOfSigned: cancelled,
      conversion: { num: soldCohort, den: gelopen },
      payDaysAvg: payN > 0 ? round1(paySum / payN) : null,
    };
  });
}

export type Focus =
  | "toegewezen"
  | "gelopen"
  | "open"
  | "open_vervolg"
  | "afgeboekt"
  | "sale"
  | "onbekend"
  | "getekend"
  | "aanbetaald"
  | "tijdig"
  | "in_termijn"
  | "open_7"
  | "geen_aanbetaling"
  | "geannuleerd"
  | "netto"
  | "niet_toegerekend";

export function inSelectedPeriod(row: Dossier, range: DateRange): boolean {
  return (
    ymdInRange(row.assignmentYmd, range) ||
    gelopenIn(row, range) ||
    ymdInRange(row.signedYmd, range) ||
    (row.netto && ymdInRange(row.nettoYmd, range))
  );
}

export function matchesFocus(row: Dossier, focus: Focus, range: DateRange): boolean {
  switch (focus) {
    case "toegewezen":
      return ymdInRange(row.assignmentYmd, range);
    case "gelopen":
      return gelopenIn(row, range);
    case "open":
      return gelopenIn(row, range) && row.stand === "open";
    case "open_vervolg":
      return gelopenIn(row, range) && row.stand === "open_vervolg";
    case "afgeboekt":
      return gelopenIn(row, range) && row.stand === "afgeboekt";
    case "sale":
      return gelopenIn(row, range) && row.stand === "sale";
    case "onbekend":
      return ymdInRange(row.assignmentYmd, range) && row.bezoek === "onbekend";
    case "getekend":
      return ymdInRange(row.signedYmd, range);
    case "aanbetaald":
      return ymdInRange(row.signedYmd, range) && row.depositMet && !row.cancelled;
    case "tijdig":
      return ymdInRange(row.signedYmd, range) && row.timelyKnown === true;
    case "in_termijn":
      return ymdInRange(row.signedYmd, range) && row.inTerm;
    case "open_7":
      return ymdInRange(row.signedYmd, range) && row.openOver7;
    case "geen_aanbetaling":
      return ymdInRange(row.signedYmd, range) && row.depositNone;
    case "geannuleerd":
      return ymdInRange(row.signedYmd, range) && row.cancelled;
    case "netto":
      return row.netto && ymdInRange(row.nettoYmd, range);
    case "niet_toegerekend":
      return (
        row.attribution === "onzeker" &&
        (ymdInRange(row.assignmentYmd, range) ||
          gelopenIn(row, range) ||
          ymdInRange(row.signedYmd, range))
      );
    default:
      return false;
  }
}

export function weeksActiveApprox(assignmentYmds: string[], today: string): number | null {
  const dates = assignmentYmds.filter(Boolean).sort();
  if (dates.length === 0) return null;
  const first = weekRangeContaining(dates[0]!).from;
  const end = today < dates[dates.length - 1]! ? dates[dates.length - 1]! : today;
  const days = daysInclusive(first, end);
  if (days <= 0) return null;
  return Math.max(1, Math.round(days / 7));
}

export type PayBuckets = {
  days0to4: number;
  days5to7: number;
  over7: number;
  paidUnknown: number;
  unpaid: number;
  none: number;
};

export type OutcomeGroup = {
  key: string;
  label: string;
  n: number;
  cancelled: number;
  netto: number;
  open: number;
};

export function signedPaymentView(rows: Dossier[], range: DateRange): {
  buckets: PayBuckets;
  groups: OutcomeGroup[];
} {
  const buckets: PayBuckets = {
    days0to4: 0,
    days5to7: 0,
    over7: 0,
    paidUnknown: 0,
    unpaid: 0,
    none: 0,
  };
  const groups: Record<string, OutcomeGroup> = {
    tijdig: { key: "tijdig", label: "Tijdig betaald", n: 0, cancelled: 0, netto: 0, open: 0 },
    laat: { key: "laat", label: "Laat betaald", n: 0, cancelled: 0, netto: 0, open: 0 },
    open: { key: "open", label: "Nog niet betaald", n: 0, cancelled: 0, netto: 0, open: 0 },
    geen: { key: "geen", label: "Geen aanbetaling vereist", n: 0, cancelled: 0, netto: 0, open: 0 },
    onbekend: { key: "onbekend", label: "Betaald, datum onbekend", n: 0, cancelled: 0, netto: 0, open: 0 },
  };
  for (const row of rows) {
    if (!ymdInRange(row.signedYmd, range)) continue;
    let group = groups.open;
    if (row.depositNone) {
      buckets.none += 1;
      group = groups.geen;
    } else if (row.depositMet && row.payDays == null) {
      buckets.paidUnknown += 1;
      group = groups.onbekend;
    } else if (row.payDays == null) {
      buckets.unpaid += 1;
      group = groups.open;
    } else if (row.payDays <= 4) {
      buckets.days0to4 += 1;
      group = row.timelyKnown === false ? groups.laat : groups.tijdig;
    } else if (row.payDays <= 7) {
      buckets.days5to7 += 1;
      group = row.timelyKnown === false ? groups.laat : groups.tijdig;
    } else {
      buckets.over7 += 1;
      group = groups.laat;
    }
    group.n += 1;
    if (row.cancelled) group.cancelled += 1;
    else if (row.netto) group.netto += 1;
    else group.open += 1;
  }
  return { buckets, groups: Object.values(groups) };
}

export function targetWarning(gelopen: number | null, deals: number | null, conversie: number | null): string | null {
  if (gelopen == null || deals == null || conversie == null) return null;
  if (gelopen <= 0) return null;
  const expected = Math.round((gelopen * conversie) / 100);
  if (Math.abs(expected - deals) >= 1) {
    return `${gelopen} gesprekken bij ${conversie}% is ongeveer ${expected} deals, het dealdoel is ${deals}.`;
  }
  return null;
}

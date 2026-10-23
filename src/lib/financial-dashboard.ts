import {
  addDays,
  addWeeks,
  differenceInCalendarDays,
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { STANDAARD_INSTALLATIEKOSTEN, hardwareKostenVoorRegels } from "@/lib/project-kosten";
import {
  factuurIsBetaald,
  isAanbetalingFactuurOmschrijving,
} from "@/lib/aanbetaling";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";
import {
  commissiePctToFraction,
  commissieTrancheA,
  commissieTrancheB,
} from "@/lib/netto-boord";
import type { RapportageRaw } from "@/lib/rapportage";

/** Adviseur commissie-% map: adviseur_id → percentage (0-100) */
export type CommissieMap = Map<string, number>;

const TZ = "Europe/Amsterdam";
const MS_DAY = 24 * 60 * 60 * 1000;
/** Restbetaling / 100% betaald: modelmatig 5 weken na ondertekenen. */
const FULL_PAY_AFTER_MS = 5 * 7 * MS_DAY;
/** Partner-installatie: betalen binnen 7 dagen na installatie (= relatie-betaaltermijn). */
const INSTALL_PAY_AFTER_DAYS = 7;
/** Vooruitblik: huidige week + 7 weken (~2 maanden). */
const CASHFLOW_WEEK_COUNT = 8;

/** Tarik loon: vast + variabel per ingepland huisbezoek. */
export const TARIK_FIXED_PER_MONTH = 3000;
export const TARIK_PER_INGEPLANDE_AFSPRAAK = 15;
/** Weekfactuur ≈ maandsalaris / (52/12) weken. */
export const TARIK_FIXED_PER_WEEK =
  Math.round(((TARIK_FIXED_PER_MONTH * 12) / 52) * 100) / 100;

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

/** Free cashflow snapshot: periode-cijfers + vooruitblik. */
export type CashflowInkomenRow = {
  label: string;
  status: "open" | "betaald" | "verwacht";
  bedragIncBtw: number;
};

export type CashflowInkoopRow = {
  product: string;
  orderLabel: string;
  bedragExBtw: number;
};

export type CashflowInstallatieRow = {
  label: string;
  bedragExBtw: number;
  /** Geplande installatiedatum (ISO) */
  installatieAt?: string | null;
  /** Uiterste betaaldatum = installatie + 7d (ISO) */
  betaalAt?: string | null;
};

export type CashflowSalesRow = {
  label: string;
  bedragExBtw: number;
  betaalAt?: string | null;
};

export type CashflowOverigRow = {
  label: string;
  bedrag: number;
  betaalAt?: string | null;
};

export type FreeCashflowWeekDetails = {
  inkomsten: CashflowInkomenRow[];
  inkoop: CashflowInkoopRow[];
  installatie: CashflowInstallatieRow[];
  sales: CashflowSalesRow[];
  overig: CashflowOverigRow[];
};

/** Kostenpost in de uitgaven-forecast. */
export type ExpenseCostPostKey =
  | "btw"
  | "inkoop"
  | "installatie"
  | "sales"
  | "loon"
  | "leads"
  | "credit"
  | "overig";

export type ExpenseForecastLine = {
  costPost: ExpenseCostPostKey;
  label: string;
  bedrag: number;
  /** yyyy-MM-dd */
  betaalDatum: string;
  /** Korte uitleg wanneer / waarom */
  wanneer: string;
  detail?: string;
};

export type ExpenseForecastByPost = {
  key: ExpenseCostPostKey;
  label: string;
  bedrag: number;
  wanneer: string;
  lines: ExpenseForecastLine[];
};

/** Uitgaven-forecast: overzicht + per kostenpost + komende maand. */
export type ExpenseForecast = {
  horizonLabel: string;
  monthLabel: string;
  monthStart: string;
  monthEnd: string;
  monthTotaal: number;
  horizonTotaal: number;
  byCostPost: ExpenseForecastByPost[];
  monthByCostPost: ExpenseForecastByPost[];
  /** Komende 14 dagen — hoofddashboard-stand */
  twoWeekByCostPost: ExpenseForecastByPost[];
  twoWeekTotaal: number;
  twoWeekStart: string;
  twoWeekEnd: string;
  lines: ExpenseForecastLine[];
};

/** BTW op partner-installatie (selfbilling). */
export const INSTALL_BTW_PCT = 0.21;

export function installatieInclBtw(exBtw: number): number {
  return Math.round(exBtw * (1 + INSTALL_BTW_PCT) * 100) / 100;
}

export type FreeCashflowWeekRow = {
  week: number;
  year: number;
  label: string;
  beginstand: number;
  /** Nog te ontvangen (open rest / open facturen). */
  verwachtBinnen: number;
  /** Al ontvangen: betaalde facturen in die week (op betaald_op). */
  daadwerkelijkBinnen: number;
  verwachtUit: number;
  eindstand: number;
  vrijeCash: number;
  details: FreeCashflowWeekDetails;
};

export type FreeCashflowSnapshot = {
  omzetExBtw: number;
  betaaldeOmzetExBtw: number;
  inkomstenIncBtw: number;
  verwachteInkomsten5wIncBtw: number;
  verwachteWarmtefondsIncBtw: number;
  verwachteEigenMiddelenIncBtw: number;
  verwachteDeals: number;
  afTeDragenBtw: number;
  teBetalenInkoop5w: number;
  /** Verwachte installatiekosten (€675/stuk of projectkosten) in de vooruitblik. */
  teBetalenInstallatie: number;
  /** Verwachte sales-commissie in de vooruitblik. */
  teBetalenSales: number;
  /** Tarik loon (vast + €15/afspraak) in de vooruitblik. */
  teBetalenLoon: number;
  openstaandeFacturenIncBtw: number;
  openstaandeRestOrdersIncBtw: number;
  adSpendPeriode: number;
  /** Inkomsten incl. btw − ads − verwachte inkoop (indicatie). */
  freeCashflowProxy: number;
  beginsaldo: number;
  beginsaldoOntbreekt: boolean;
  /** Nog af te dragen / gereserveerde btw (lock op vrije cash). */
  btwTeBetalen: number;
  /** Kwartaal-label van de eerstvolgende BTW-aangifte (bijv. 2026-Q3). */
  btwKwartaalLabel: string | null;
  /** Uiterste betaaldatum BTW (yyyy-MM-dd). */
  btwBetaalDatum: string | null;
  weeks: FreeCashflowWeekRow[];
  /** Uitgaven-forecast per kostenpost + komende maand. */
  expenseForecast: ExpenseForecast;
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
  freeCashflow: FreeCashflowSnapshot;
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

function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}

function nextWednesdayOnOrAfter(d: Date): Date {
  const z = toZonedTime(d, TZ);
  const day = z.getDay(); // 0 zo … 3 wo
  const add = day === 3 ? 0 : (3 - day + 7) % 7;
  return fromZonedTime(
    new Date(z.getFullYear(), z.getMonth(), z.getDate() + add, 12, 0, 0, 0),
    TZ
  );
}

/**
 * NL BTW-aangifte: kwartaal, uiterlijk laatste dag van de maand erna.
 * Q1→30 apr, Q2→31 jul, Q3→31 okt, Q4→31 jan.
 * In okt (Q4) is de eerstvolgende dus nog Q3 (uiterlijk 31 okt), niet Q4.
 */
export function resolveNextBtwAangifte(now = new Date()): {
  label: string;
  dueYmd: string;
  dueDate: Date;
  quarterStart: Date;
  quarterEnd: Date;
} {
  const z = toZonedTime(now, TZ);
  const y = z.getFullYear();
  const q = Math.floor(z.getMonth() / 3); // 0..3 huidig kwartaal
  // Vorige kwartaal eerst: aangifte valt in de 1e maand van het huidige kwartaal
  const prevQi = q === 0 ? 3 : q - 1;
  const prevQy = q === 0 ? y - 1 : y;
  const candidates: { qi: number; qy: number }[] = [
    { qi: prevQi, qy: prevQy },
    { qi: q, qy: y },
    { qi: (q + 1) % 4, qy: q === 3 ? y + 1 : y },
  ];

  for (const c of candidates) {
    // Due-maand: Q1→apr(3), Q2→jul(6), Q3→okt(9), Q4→jan(0) volgend jaar
    const dueMonth = [3, 6, 9, 0][c.qi]!;
    const dueYear = c.qi === 3 ? c.qy + 1 : c.qy;
    const dueDay = dueMonth === 0 || dueMonth === 6 ? 31 : 30;
    const dueDate = fromZonedTime(
      new Date(dueYear, dueMonth, dueDay, 12, 0, 0, 0),
      TZ
    );
    if (dueDate.getTime() < amsStartOfDay(now).getTime()) continue;

    const qStartMonth = c.qi * 3;
    const quarterStart = fromZonedTime(
      new Date(c.qy, qStartMonth, 1, 0, 0, 0, 0),
      TZ
    );
    const quarterEnd = fromZonedTime(
      new Date(c.qy, qStartMonth + 3, 0, 23, 59, 59, 999),
      TZ
    );
    return {
      label: `${c.qy}-Q${c.qi + 1}`,
      dueYmd: ymdAmsterdam(dueDate),
      dueDate,
      quarterStart,
      quarterEnd,
    };
  }

  // Fallback: Q1 volgend jaar
  const fy = y + 1;
  const dueDate = fromZonedTime(new Date(fy, 3, 30, 12, 0, 0, 0), TZ);
  return {
    label: `${fy}-Q1`,
    dueYmd: ymdAmsterdam(dueDate),
    dueDate,
    quarterStart: fromZonedTime(new Date(fy, 0, 1, 0, 0, 0, 0), TZ),
    quarterEnd: fromZonedTime(new Date(fy, 2, 31, 23, 59, 59, 999), TZ),
  };
}

function installatieKostenBedrag(projectkosten: number | null | undefined): number {
  const pk = Number(projectkosten);
  if (Number.isFinite(pk) && pk > 0) return round2(pk);
  return STANDAARD_INSTALLATIEKOSTEN;
}

function costPostLabel(key: ExpenseCostPostKey): string {
  switch (key) {
    case "btw":
      return "BTW-afdracht";
    case "inkoop":
      return "Purchasing (te bestellen)";
    case "installatie":
      return "Installatiekosten";
    case "sales":
      return "Sales / commissie";
    case "loon":
      return "Loonkosten (Tarik)";
    case "leads":
      return "Leadkosten (ads)";
    case "credit":
      return "Credit terugbetaling";
    default:
      return "Overig";
  }
}

function groupExpenseLines(
  lines: ExpenseForecastLine[]
): ExpenseForecastByPost[] {
  const order: ExpenseCostPostKey[] = [
    "inkoop",
    "installatie",
    "sales",
    "loon",
    "leads",
    "credit",
    "overig",
    "btw",
  ];
  const by = new Map<ExpenseCostPostKey, ExpenseForecastLine[]>();
  for (const line of lines) {
    const arr = by.get(line.costPost) || [];
    arr.push(line);
    by.set(line.costPost, arr);
  }
  return order
    .filter((k) => (by.get(k) || []).length > 0)
    .map((k) => {
      const ls = by.get(k) || [];
      const bedrag = round2(ls.reduce((s, l) => s + l.bedrag, 0));
      const wanneer =
        k === "btw"
          ? "Uiterlijk kwartaal-deadline"
          : k === "installatie"
            ? `Binnen ${INSTALL_PAY_AFTER_DAYS} dagen na installatie`
            : k === "sales"
              ? "€250 bij betaalde aanbetaling · rest woensdag na installatie"
              : k === "loon"
                ? "Weekfactuur · betalen maandag na werkweek (ma–vr)"
                : k === "leads"
                  ? "Doorlopend (weekgemiddelde ads)"
                  : k === "inkoop"
                    ? "Purchasing · Te bestellen (schouw-PDF + te kopen)"
                    : k === "credit"
                      ? "Terugbetaling · origineel was betaald"
                      : "Overig";
      return {
        key: k,
        label: costPostLabel(k),
        bedrag,
        wanneer,
        lines: ls.sort((a, b) => a.betaalDatum.localeCompare(b.betaalDatum)),
      };
    });
}

function isHuisbezoekVoorLoon(soort: string | null | undefined): boolean {
  const s = (soort || "nieuw").toLowerCase();
  return s !== "bel" && s !== "warme_bel";
}

export function resolveFinancialRange(
  range: FinancialDateRange,
  now = new Date()
): { start: Date; end: Date; previousStart: Date; previousEnd: Date } {
  const z = toZonedTime(now, TZ);
  let start: Date;
  let end = amsEndOfDay(now);

  switch (range) {
    case "this_week":
      start = amsStartOfDay(startOfWeek(z, { weekStartsOn: 1 }));
      break;
    case "last_7_days":
      // Gelijk aan Meta: N dagen t/m gisteren
      end = amsEndOfDay(addDays(z, -1));
      start = amsStartOfDay(addDays(z, -7));
      break;
    case "this_month":
      start = amsStartOfDay(startOfMonth(z));
      break;
    case "last_30_days":
      end = amsEndOfDay(addDays(z, -1));
      start = amsStartOfDay(addDays(z, -30));
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

function orderIncBtw(o: RapportageRaw["offertes"][0]): number {
  if (o.totaal_inc_btw != null && Number(o.totaal_inc_btw) > 0) {
    return round2(Number(o.totaal_inc_btw));
  }
  const ex = Number(o.subtotaal_ex_btw) || 0;
  if (o.btw_bedrag != null && Number(o.btw_bedrag) > 0) {
    return round2(ex + Number(o.btw_bedrag));
  }
  return round2(ex * 1.21);
}

function factuurIncBtw(f: RapportageRaw["facturen"][0]): number {
  if (f.bedrag_inc_btw != null && Number.isFinite(Number(f.bedrag_inc_btw))) {
    const n = Number(f.bedrag_inc_btw);
    if (n !== 0) return round2(Math.abs(n));
  }
  const ex = Math.abs(Number(f.bedrag_ex_btw) || 0);
  if (f.btw_bedrag != null && Number.isFinite(Number(f.btw_bedrag))) {
    return round2(ex + Math.abs(Number(f.btw_bedrag)));
  }
  return round2(ex * 1.21);
}

function factuurBtw(f: RapportageRaw["facturen"][0]): number {
  if (f.btw_bedrag != null && Number.isFinite(Number(f.btw_bedrag))) {
    return round2(Math.abs(Number(f.btw_bedrag)));
  }
  const ex = Math.abs(Number(f.bedrag_ex_btw) || 0);
  const inc = factuurIncBtw(f);
  return round2(Math.max(0, inc - ex));
}

function isCreditFactuur(f: {
  credit_van_factuur_id?: string | null;
}): boolean {
  return Boolean(f.credit_van_factuur_id);
}

/**
 * Free cashflow:
 * - periode: getekende omzet, betaald ex/incl (− credits op betaalde facturen)
 * - vooruitblik: rest (~5w), purchasing = Purchasing-tab “Te bestellen”
 *   (schouw-PDF + te_kopen, volledig betaald),
 *   installatiekosten alleen bij echte installatie_at (≤7d na, incl. btw),
 *   sales-commissie (€250 bij aanbetaling betaald · rest na installatie),
 *   leadkosten (ads), credit-terugbetalingen
 * - BTW-kwartaal: af te dragen obv betaalde facturen (− credits) in cashstand
 */
export function buildFreeCashflow(
  raw: RapportageRaw,
  kosten: RapportageKostenRow[],
  adviseurId: string | null,
  start: Date,
  end: Date,
  now = new Date(),
  opts?: {
    beginsaldoCash?: number | null;
    btwReservering?: number | null;
    /** Adviseur-id van Tarik (loon €15/afspraak + €3000/mnd). */
    tarikId?: string | null;
  },
  commissieMap?: CommissieMap
): FreeCashflowSnapshot {
  const offertes = (
    adviseurId
      ? raw.offertes.filter((o) => o.adviseur_id === adviseurId)
      : raw.offertes
  ).filter((o) => o.status === "ondertekend" && o.ondertekend_op);

  const facturen = adviseurId
    ? (raw.facturen || []).filter((f) => f.adviseur_id === adviseurId)
    : raw.facturen || [];

  const projecten = adviseurId
    ? raw.projecten.filter((p) => p.adviseur_id === adviseurId)
    : raw.projecten;

  let omzetExBtw = 0;
  let betaaldeOmzetExBtw = 0;
  let inkomstenIncBtw = 0;
  let afTeDragenBtw = 0;
  let adSpendPeriode = 0;

  for (const o of offertes) {
    if (!inRange(o.ondertekend_op!, start, end)) continue;
    omzetExBtw += Number(o.subtotaal_ex_btw) || 0;
  }

  const factuurById = new Map(facturen.map((f) => [f.id, f]));

  for (const f of facturen) {
    if (f.status === "concept" || f.status === "vervallen") continue;

    if (isCreditFactuur(f)) {
      // Credit alleen meetellen als origineel betaald was (anders: herroeping, geen cash)
      const orig = f.credit_van_factuur_id
        ? factuurById.get(f.credit_van_factuur_id)
        : null;
      if (!orig || !factuurIsBetaald(orig.status, orig.betaald_op)) continue;
      const creditIso = f.betaald_op || f.factuurdatum;
      if (!creditIso || !inRange(creditIso, start, end)) continue;
      betaaldeOmzetExBtw -= Math.abs(Number(f.bedrag_ex_btw) || 0);
      inkomstenIncBtw -= factuurIncBtw(f);
      afTeDragenBtw -= factuurBtw(f);
      continue;
    }

    const iso = factuurBetaalIso(f);
    if (!iso || !inRange(iso, start, end)) continue;
    betaaldeOmzetExBtw += Math.abs(Number(f.bedrag_ex_btw) || 0);
    inkomstenIncBtw += factuurIncBtw(f);
    afTeDragenBtw += factuurBtw(f);
  }
  betaaldeOmzetExBtw = round2(Math.max(0, betaaldeOmzetExBtw));
  inkomstenIncBtw = round2(Math.max(0, inkomstenIncBtw));
  afTeDragenBtw = round2(Math.max(0, afTeDragenBtw));

  for (const k of kosten) {
    if (adviseurId && k.adviseur_id && k.adviseur_id !== adviseurId) continue;
    if (!inDateRange(k.datum, start, end)) continue;
    if (k.soort === "ad_spend") adSpendPeriode += Number(k.bedrag) || 0;
  }

  const paidByOfferte = new Map<string, number>();
  const paidByLead = new Map<string, number>();
  let openstaandeFacturenIncBtw = 0;

  for (const f of facturen) {
    if (f.status === "concept" || f.status === "vervallen") continue;
    const inc = factuurIncBtw(f);

    if (isCreditFactuur(f)) {
      const orig = f.credit_van_factuur_id
        ? factuurById.get(f.credit_van_factuur_id)
        : null;
      // Alleen credits op betaalde originelen verlagen ontvangen cash
      if (!orig || !factuurIsBetaald(orig.status, orig.betaald_op)) continue;
      if (!factuurIsBetaald(f.status, f.betaald_op)) continue; // nog niet terugbetaald → niet in paid
      const offerteId = f.offerte_id || orig.offerte_id;
      if (offerteId) {
        paidByOfferte.set(
          offerteId,
          round2((paidByOfferte.get(offerteId) || 0) - inc)
        );
      }
      paidByLead.set(
        f.lead_id,
        round2((paidByLead.get(f.lead_id) || 0) - inc)
      );
      continue;
    }

    if (factuurIsBetaald(f.status, f.betaald_op)) {
      if (f.offerte_id) {
        paidByOfferte.set(
          f.offerte_id,
          round2((paidByOfferte.get(f.offerte_id) || 0) + inc)
        );
      }
      paidByLead.set(
        f.lead_id,
        round2((paidByLead.get(f.lead_id) || 0) + inc)
      );
    } else {
      openstaandeFacturenIncBtw += inc;
    }
  }

  // Huidige week + 7 weken vooruit (~2 maanden, dekt komende maand)
  const WEEK_COUNT = CASHFLOW_WEEK_COUNT;
  const horizonMs = WEEK_COUNT * 7 * MS_DAY;
  const nowMs = now.getTime();
  const horizonEnd = nowMs + horizonMs;
  const zNow = toZonedTime(now, TZ);
  const week0Monday = startOfISOWeek(zNow);
  const expenseLines: ExpenseForecastLine[] = [];

  type Bucket = {
    binnen: number;
    daadwerkelijkBinnen: number;
    uitInkoop: number;
    uitInstallatie: number;
    uitSales: number;
    uitLoon: number;
    uitAds: number;
    uitBtw: number;
    inkomsten: CashflowInkomenRow[];
    inkoop: CashflowInkoopRow[];
    installatie: CashflowInstallatieRow[];
    sales: CashflowSalesRow[];
    overig: CashflowOverigRow[];
  };
  const buckets: Bucket[] = Array.from({ length: WEEK_COUNT }, () => ({
    binnen: 0,
    daadwerkelijkBinnen: 0,
    uitInkoop: 0,
    uitInstallatie: 0,
    uitSales: 0,
    uitLoon: 0,
    uitAds: 0,
    uitBtw: 0,
    inkomsten: [],
    inkoop: [],
    installatie: [],
    sales: [],
    overig: [],
  }));
  let teBetalenLoon = 0;
  const tarikId = (opts?.tarikId || "").trim() || null;

  function weekIndexForDate(d: Date): number {
    const z = toZonedTime(d, TZ);
    const monday = startOfISOWeek(z);
    const days = differenceInCalendarDays(monday, week0Monday);
    const idx = Math.floor(days / 7);
    if (idx < 0) return 0; // overdue → deze week
    if (idx >= WEEK_COUNT) return WEEK_COUNT - 1;
    return idx;
  }

  function orderLabel(o: RapportageRaw["offertes"][0]): string {
    return (
      o.offerte_nummer ||
      o.lead_naam ||
      `Order ${o.id.slice(0, 8)}`
    );
  }

  function factuurLabel(f: RapportageRaw["facturen"][0]): string {
    if (f.factuur_nummer) return f.factuur_nummer;
    if (f.omschrijving?.trim()) return f.omschrijving.trim().slice(0, 40);
    return `Factuur ${f.id.slice(0, 8)}`;
  }

  const beginsaldoOntbreekt =
    opts?.beginsaldoCash == null || !Number.isFinite(Number(opts.beginsaldoCash));
  const beginsaldo = beginsaldoOntbreekt
    ? 0
    : round2(Number(opts!.beginsaldoCash));

  // Ads: spreid recent weekgemiddelde over vooruitblik (= leadkosten)
  const daysInPeriod = Math.max(
    1,
    differenceInCalendarDays(end, start) + 1
  );
  const adsPerWeek = round2((adSpendPeriode / daysInPeriod) * 7);
  for (let i = 0; i < WEEK_COUNT; i++) {
    buckets[i].uitAds += adsPerWeek;
    if (adsPerWeek > 0) {
      const monday = addWeeks(week0Monday, i);
      const betaalDatum = ymdAmsterdam(monday);
      buckets[i].overig.push({
        label: "Leadkosten / ad spend (weekgemiddelde)",
        bedrag: adsPerWeek,
        betaalAt: monday.toISOString(),
      });
      expenseLines.push({
        costPost: "leads",
        label: `Ads week ${getISOWeek(monday)}`,
        bedrag: adsPerWeek,
        betaalDatum,
        wanneer: "Doorlopend weekgemiddelde uit ads-periode",
      });
    }
  }

  // Tarik loon: per werkweek (ma–vr) factuur = vast weekdeel + €15 × ingeplande huisbezoeken.
  // Betaaldatum = maandag ná die werkweek (weekMaandag + 7 dagen).
  // Incl. 2 weken terug (nog openstaande weekfacturen).
  if (tarikId) {
    for (let workWeekIdx = -2; workWeekIdx < WEEK_COUNT; workWeekIdx++) {
      const weekMon = addWeeks(week0Monday, workWeekIdx);
      const weekFriEnd = fromZonedTime(
        (() => {
          const z = toZonedTime(weekMon, TZ);
          return new Date(
            z.getFullYear(),
            z.getMonth(),
            z.getDate() + 4,
            23,
            59,
            59,
            999
          );
        })(),
        TZ
      );
      const weekMonStart = fromZonedTime(
        (() => {
          const z = toZonedTime(weekMon, TZ);
          return new Date(z.getFullYear(), z.getMonth(), z.getDate(), 0, 0, 0, 0);
        })(),
        TZ
      );
      let apptCount = 0;
      for (const a of raw.afspraken || []) {
        if (a.status === "geannuleerd") continue;
        if (!isHuisbezoekVoorLoon(a.soort)) continue;
        const door = (a.ingepland_door_id || "").trim();
        if (door !== tarikId) continue;
        const plannedAt = a.created_at || a.start_at;
        if (!plannedAt) continue;
        const t = new Date(plannedAt).getTime();
        if (t < weekMonStart.getTime() || t > weekFriEnd.getTime()) continue;
        apptCount += 1;
      }
      const variabel = round2(apptCount * TARIK_PER_INGEPLANDE_AFSPRAAK);
      const vast = TARIK_FIXED_PER_WEEK;
      const totaal = round2(vast + variabel);
      if (!(totaal > 0)) continue;
      // Betalen maandag na de werkweek
      const payAt = addWeeks(weekMon, 1);
      if (payAt.getTime() > horizonEnd + MS_DAY) continue;
      const payIdx = weekIndexForDate(payAt);
      teBetalenLoon += totaal;
      buckets[payIdx].uitLoon += totaal;
      buckets[payIdx].overig.push({
        label: `Tarik week ${getISOWeek(weekMon)} · vast €${vast}${
          apptCount > 0
            ? ` + ${apptCount}×€${TARIK_PER_INGEPLANDE_AFSPRAAK}`
            : ""
        }`,
        bedrag: totaal,
        betaalAt: payAt.toISOString(),
      });
      expenseLines.push({
        costPost: "loon",
        label: `Tarik · week ${getISOWeek(weekMon)}`,
        bedrag: totaal,
        betaalDatum: ymdAmsterdam(payAt),
        wanneer: `Maandag na werkweek ma–vr (week ${getISOWeek(weekMon)})`,
        detail: `€${vast} vast + €${variabel} (${apptCount}×€${TARIK_PER_INGEPLANDE_AFSPRAAK})`,
      });
    }
  }

  let verwachteWarmtefondsIncBtw = 0;
  let verwachteEigenMiddelenIncBtw = 0;
  let verwachteDeals = 0;
  let openstaandeRestOrdersIncBtw = 0;
  let teBetalenInkoop5w = 0;
  let teBetalenInstallatie = 0;
  let teBetalenSales = 0;
  const scheduledInstallPay = new Set<string>(); // project id / offerte id

  /** Open (nog niet betaalde) facturen per offerte — voor aftrek op order-rest. */
  const openByOfferte = new Map<string, number>();

  /**
   * Weekindex voor betaalde factuur.
   * - Binnen horizon → die week
   * - Vóór horizon + geen beginsaldo → week 0 (anders verdwijnen betaalde facturen)
   * - Vóór horizon + wel beginsaldo → null (al in bankstand)
   */
  function weekIndexForPaid(d: Date): number | null {
    const z = toZonedTime(d, TZ);
    const monday = startOfISOWeek(z);
    const days = differenceInCalendarDays(monday, week0Monday);
    const idx = Math.floor(days / 7);
    if (idx >= 0 && idx < WEEK_COUNT) return idx;
    if (idx < 0) {
      return beginsaldoOntbreekt ? 0 : null;
    }
    return WEEK_COUNT - 1;
  }

  // 1) Facturen: betaald → daadwerkelijk; open → verwacht (credits apart als terugbetaling)
  for (const f of facturen) {
    if (f.status === "concept" || f.status === "vervallen") continue;
    if (isCreditFactuur(f)) continue; // geen inkomsten; refund hieronder
    const inc = factuurIncBtw(f);
    if (!(inc > 0)) continue;

    if (factuurIsBetaald(f.status, f.betaald_op)) {
      const iso = factuurBetaalIso(f);
      if (!iso) continue;
      const idx = weekIndexForPaid(new Date(iso));
      if (idx == null) continue;
      buckets[idx].daadwerkelijkBinnen += inc;
      buckets[idx].inkomsten.push({
        label: factuurLabel(f),
        status: "betaald",
        bedragIncBtw: inc,
      });
      continue;
    }

    const due = new Date(f.factuurdatum || now);
    const idx = weekIndexForDate(due);
    buckets[idx].binnen += inc;
    buckets[idx].inkomsten.push({
      label: factuurLabel(f),
      status: "open",
      bedragIncBtw: inc,
    });
    if (f.offerte_id) {
      openByOfferte.set(
        f.offerte_id,
        round2((openByOfferte.get(f.offerte_id) || 0) + inc)
      );
    }
  }

  // 2) Orders: rest (nog niet gefactureerd/betaald) modelmatig ~5w na tekenen
  for (const o of offertes) {
    const orderInc = orderIncBtw(o);
    const paid =
      (o.id && paidByOfferte.get(o.id)) ||
      paidByLead.get(o.lead_id) ||
      0;
    const remaining = round2(Math.max(0, orderInc - paid));
    const openInv = o.id ? openByOfferte.get(o.id) || 0 : 0;
    const restNogNietGefactureerd = round2(Math.max(0, remaining - openInv));
    const signedAt = new Date(o.ondertekend_op!);
    const signedMs = signedAt.getTime();
    const fullPayAt = new Date(signedMs + FULL_PAY_AFTER_MS);
    const oLabel = orderLabel(o);

    if (remaining > 0) {
      openstaandeRestOrdersIncBtw += remaining;
    }

    if (restNogNietGefactureerd > 0 && fullPayAt.getTime() <= horizonEnd) {
      verwachteDeals += 1;
      if (o.financiering_voorbehoud) {
        verwachteWarmtefondsIncBtw += restNogNietGefactureerd;
      } else {
        verwachteEigenMiddelenIncBtw += restNogNietGefactureerd;
      }
      const idx = weekIndexForDate(fullPayAt);
      buckets[idx].binnen += restNogNietGefactureerd;
      buckets[idx].inkomsten.push({
        label: `Rest ${oLabel}`,
        status: "verwacht",
        bedragIncBtw: restNogNietGefactureerd,
      });
    }

    const project = projecten.find((p) => p.offerte_id === o.id);
    const installedDone =
      project?.status === "installatie_voltooid" ||
      (project?.installatie_at &&
        addDays(new Date(project.installatie_at), INSTALL_PAY_AFTER_DAYS).getTime() <
          nowMs);

    // Purchasing = zelfde als tab “Te bestellen”: 100% betaald + schouw-PDF + te_kopen
    const volledigBetaald = remaining <= 0.01;
    const teBestellenEx = round2(Number(project?.te_bestellen_ex_btw) || 0);
    const inPurchasingTeBestellen =
      Boolean(project?.heeft_schouw_pdf) && teBestellenEx > 0;
    if (
      !installedDone &&
      volledigBetaald &&
      inPurchasingTeBestellen
    ) {
      const inkoopAt = new Date(nowMs);
      const idx = weekIndexForDate(inkoopAt);
      teBetalenInkoop5w += teBestellenEx;
      buckets[idx].uitInkoop += teBestellenEx;
      buckets[idx].inkoop.push({
        product: "Te bestellen",
        orderLabel: oLabel,
        bedragExBtw: teBestellenEx,
      });
      expenseLines.push({
        costPost: "inkoop",
        label: project?.project_nummer || oLabel,
        bedrag: teBestellenEx,
        betaalDatum: ymdAmsterdam(inkoopAt),
        wanneer: project?.installatie_at
          ? `Te bestellen · installatie ${ymdAmsterdam(new Date(project.installatie_at))}`
          : "Te bestellen · nu",
        detail: "Purchasing-tab Te bestellen (schouw-PDF + te kopen)",
      });
    }

    // Installatie: alleen echte installatie_at — betalen ≤7d na, bedragen incl. 21% btw
    const installAt = project?.installatie_at
      ? new Date(project.installatie_at)
      : null;
    const installPayAt = installAt
      ? addDays(installAt, INSTALL_PAY_AFTER_DAYS)
      : null;
    const kostEx = installatieKostenBedrag(project?.projectkosten);
    const kostInc = installatieInclBtw(kostEx);
    const installKey = project?.id || o.id;
    if (
      installAt &&
      installPayAt &&
      installPayAt.getTime() >= nowMs - MS_DAY &&
      installPayAt.getTime() <= horizonEnd &&
      !scheduledInstallPay.has(installKey)
    ) {
      scheduledInstallPay.add(installKey);
      const idx = weekIndexForDate(installPayAt);
      teBetalenInstallatie += kostInc;
      buckets[idx].uitInstallatie += kostInc;
      buckets[idx].installatie.push({
        label: project?.project_nummer || oLabel,
        bedragExBtw: kostEx,
        installatieAt: installAt.toISOString(),
        betaalAt: installPayAt.toISOString(),
      });
      expenseLines.push({
        costPost: "installatie",
        label: project?.project_nummer || oLabel,
        bedrag: kostInc,
        betaalDatum: ymdAmsterdam(installPayAt),
        wanneer: `Installatie ${ymdAmsterdam(installAt)} + ${INSTALL_PAY_AFTER_DAYS}d`,
        detail: `€${kostEx} ex + 21% btw = €${kostInc} incl.`,
      });
    }

    // Sales-commissie: €250 bij betaalde aanbetaling · rest na installatie voltooid
    const omzetEx = Number(o.subtotaal_ex_btw) || 0;
    if (omzetEx > 0) {
      const orderFacs = facturen.filter(
        (f) =>
          f.offerte_id === o.id ||
          (!f.offerte_id && f.lead_id === o.lead_id)
      );
      const aanbetaling = orderFacs.find(
        (f) =>
          !isCreditFactuur(f) &&
          factuurIsBetaald(f.status, f.betaald_op) &&
          isAanbetalingFactuurOmschrijving(f.omschrijving)
      );
      const salesAdvId = o.adviseur_id || project?.adviseur_id || null;
      const salesPct =
        salesAdvId && commissieMap ? commissieMap.get(salesAdvId) : undefined;
      const trancheA = commissieTrancheA(omzetEx, salesPct);
      const trancheB = commissieTrancheB(omzetEx, salesPct);
      const salesPctLabel = Math.round(commissiePctToFraction(salesPct) * 100);

      function pushSales(
        bedrag: number,
        triggerAt: Date,
        label: string,
        wanneer: string,
        detail: string
      ) {
        if (!(bedrag > 0)) return;
        const salesPayAt = nextWednesdayOnOrAfter(triggerAt);
        // Oudere woensdagen (>1 week geleden) → al uitgekeerd / niet opnieuw aftrekken
        if (salesPayAt.getTime() < nowMs - 7 * MS_DAY) return;
        if (salesPayAt.getTime() > horizonEnd) return;
        const idx = weekIndexForDate(salesPayAt);
        teBetalenSales += bedrag;
        buckets[idx].uitSales += bedrag;
        buckets[idx].sales.push({
          label,
          bedragExBtw: bedrag,
          betaalAt: salesPayAt.toISOString(),
        });
        expenseLines.push({
          costPost: "sales",
          label,
          bedrag,
          betaalDatum: ymdAmsterdam(salesPayAt),
          wanneer,
          detail,
        });
      }

      if (aanbetaling) {
        const paidAt = new Date(
          factuurBetaalIso(aanbetaling) || aanbetaling.betaald_op || now
        );
        pushSales(
          trancheA,
          paidAt,
          `Commissie aanbetaling · ${oLabel}`,
          "Woensdag na betaalde aanbetaling",
          `Tranche A · €${trancheA}`
        );
      }

      const installVoltooid =
        project?.status === "installatie_voltooid" ||
        project?.status === "review_gevraagd" ||
        project?.status === "service" ||
        Boolean(project?.installatie_voltooid_at);
      if (installVoltooid && trancheB > 0) {
        const doneAt = project?.installatie_voltooid_at
          ? new Date(project.installatie_voltooid_at)
          : project?.installatie_at
            ? new Date(project.installatie_at)
            : new Date(nowMs);
        pushSales(
          trancheB,
          doneAt,
          `Commissie rest · ${oLabel}`,
          "Woensdag na installatie voltooid",
          `Tranche B · ${salesPctLabel}% − €${trancheA}`
        );
      }
    }
  }

  // Geplande installaties in agenda zonder dat we ze al via offerte pakten
  for (const project of projecten) {
    if (!project.installatie_at) continue;
    if (scheduledInstallPay.has(project.id)) continue;
    if (project.status === "installatie_voltooid") {
      // Al voltooid: alleen nog tonen als betaaldeadline (≥ install+7d) nog in horizon ligt
    }
    const installAt = new Date(project.installatie_at);
    const installPayAt = addDays(installAt, INSTALL_PAY_AFTER_DAYS);
    if (installPayAt.getTime() < nowMs - MS_DAY) continue;
    if (installPayAt.getTime() > horizonEnd) continue;
    scheduledInstallPay.add(project.id);
    const kostEx = installatieKostenBedrag(project.projectkosten);
    const kostInc = installatieInclBtw(kostEx);
    const idx = weekIndexForDate(installPayAt);
    teBetalenInstallatie += kostInc;
    buckets[idx].uitInstallatie += kostInc;
    const label = project.project_nummer || `Project ${project.id.slice(0, 8)}`;
    buckets[idx].installatie.push({
      label,
      bedragExBtw: kostEx,
      installatieAt: installAt.toISOString(),
      betaalAt: installPayAt.toISOString(),
    });
    expenseLines.push({
      costPost: "installatie",
      label,
      bedrag: kostInc,
      betaalDatum: ymdAmsterdam(installPayAt),
      wanneer: `Gepland ${ymdAmsterdam(installAt)} + ${INSTALL_PAY_AFTER_DAYS}d`,
      detail: `€${kostEx} ex + 21% btw = €${kostInc} incl.`,
    });
  }

  // Credit-terugbetalingen: alleen als origineel betaald was én credit nog niet terugbetaald
  for (const f of facturen) {
    if (!isCreditFactuur(f)) continue;
    if (f.status === "concept" || f.status === "vervallen") continue;
    const orig = f.credit_van_factuur_id
      ? factuurById.get(f.credit_van_factuur_id)
      : null;
    if (!orig || !factuurIsBetaald(orig.status, orig.betaald_op)) continue;
    // Al terugbetaald → zit al in beginsaldo / bank, niet opnieuw aftrekken
    if (factuurIsBetaald(f.status, f.betaald_op)) continue;
    const bedrag = factuurIncBtw(f);
    if (!(bedrag > 0)) continue;
    const payAt = new Date(nowMs); // openstaande terugbetaling → nu
    const idx = weekIndexForDate(payAt);
    buckets[idx].uitBtw += bedrag; // reuse bucket slot for cash-out (geen aparte uitCredit)
    buckets[idx].overig.push({
      label: `Credit ${factuurLabel(f)}`,
      bedrag,
      betaalAt: payAt.toISOString(),
    });
    expenseLines.push({
      costPost: "credit",
      label: factuurLabel(f),
      bedrag,
      betaalDatum: ymdAmsterdam(payAt),
      wanneer: "Terugbetaling · origineel was betaald",
      detail: orig.factuur_nummer
        ? `Credit op ${orig.factuur_nummer}`
        : "Credit op betaalde factuur",
    });
  }

  // BTW-afdracht eerstvolgend kwartaal (bijv. Q3 → 31 okt) obv betaalde facturen
  const btwAangifte = resolveNextBtwAangifte(now);
  let btwKwartaalBedrag = 0;
  for (const f of facturen) {
    if (isCreditFactuur(f)) {
      // Credits verlagen af te dragen BTW alleen als origineel betaald was
      const orig = f.credit_van_factuur_id
        ? factuurById.get(f.credit_van_factuur_id)
        : null;
      if (!orig || !factuurIsBetaald(orig.status, orig.betaald_op)) continue;
      if (f.status === "concept" || f.status === "vervallen") continue;
      const iso = f.betaald_op || f.factuurdatum;
      if (!iso) continue;
      const t = new Date(iso).getTime();
      if (
        t >= btwAangifte.quarterStart.getTime() &&
        t <= btwAangifte.quarterEnd.getTime()
      ) {
        btwKwartaalBedrag -= factuurBtw(f);
      }
      continue;
    }
    const iso = factuurBetaalIso(f);
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (
      t >= btwAangifte.quarterStart.getTime() &&
      t <= btwAangifte.quarterEnd.getTime()
    ) {
      btwKwartaalBedrag += factuurBtw(f);
    }
  }
  btwKwartaalBedrag = round2(Math.max(0, btwKwartaalBedrag));
  // Stand: puur kwartaal-facturen (+ optionele reservering), niet ads-periode
  const btwLock = round2(
    Math.max(btwKwartaalBedrag, Number(opts?.btwReservering) || 0)
  );
  if (btwLock > 0) {
    expenseLines.push({
      costPost: "btw",
      label: `BTW ${btwAangifte.label}`,
      bedrag: btwLock,
      betaalDatum: btwAangifte.dueYmd,
      wanneer: `Uiterlijk ${btwAangifte.dueYmd}`,
      detail: `Af te dragen obv betaalde facturen ${btwAangifte.label} (− credits)`,
    });
    if (btwAangifte.dueDate.getTime() <= horizonEnd + MS_DAY) {
      const idx = weekIndexForDate(btwAangifte.dueDate);
      buckets[idx].uitBtw += btwLock;
      buckets[idx].overig.push({
        label: `BTW-afdracht ${btwAangifte.label}`,
        bedrag: btwLock,
        betaalAt: btwAangifte.dueDate.toISOString(),
      });
    }
  }

  const weeks: FreeCashflowWeekRow[] = [];
  let cursor = beginsaldo;
  let uitRemaining = round2(
    buckets.reduce(
      (s, b) =>
        s +
        b.uitInkoop +
        b.uitInstallatie +
        b.uitSales +
        b.uitLoon +
        b.uitBtw,
      0
    )
  );

  for (let i = 0; i < WEEK_COUNT; i++) {
    const monday = addWeeks(week0Monday, i);
    const week = getISOWeek(monday);
    const year = getISOWeekYear(monday);
    const b = buckets[i];
    const verwachtBinnen = round2(b.binnen);
    const daadwerkelijkBinnen = round2(b.daadwerkelijkBinnen);
    const verwachtUit = round2(
      b.uitInkoop +
        b.uitInstallatie +
        b.uitSales +
        b.uitLoon +
        b.uitAds +
        b.uitBtw
    );
    const beginstand = round2(cursor);
    const eindstand = round2(
      beginstand + verwachtBinnen + daadwerkelijkBinnen - verwachtUit
    );
    uitRemaining = round2(
      Math.max(
        0,
        uitRemaining -
          b.uitInkoop -
          b.uitInstallatie -
          b.uitSales -
          b.uitLoon -
          b.uitBtw
      )
    );
    // Geen BTW-lock meer in stand — alleen echte uitgaven (incl. credit-terugbetalingen)
    const vrijeCash = round2(Math.max(0, eindstand - uitRemaining));
    weeks.push({
      week,
      year,
      label: `Week ${week}`,
      beginstand,
      verwachtBinnen,
      daadwerkelijkBinnen,
      verwachtUit,
      eindstand,
      vrijeCash,
      details: {
        inkomsten: b.inkomsten,
        inkoop: b.inkoop,
        installatie: b.installatie,
        sales: b.sales,
        overig: b.overig,
      },
    });
    cursor = eindstand;
  }

  const verwachteInkomsten5wIncBtw = round2(
    verwachteWarmtefondsIncBtw + verwachteEigenMiddelenIncBtw
  );

  const freeCashflowProxy = round2(
    inkomstenIncBtw -
      adSpendPeriode -
      teBetalenInkoop5w -
      teBetalenInstallatie -
      teBetalenSales -
      teBetalenLoon
  );

  // Komende kalendermaand (vanaf morgen t/m eind volgende maand-blok: rest van deze maand + volgende)
  const zMonth = toZonedTime(now, TZ);
  const monthStart = fromZonedTime(
    new Date(zMonth.getFullYear(), zMonth.getMonth(), zMonth.getDate() + 1, 0, 0, 0, 0),
    TZ
  );
  const monthEnd = fromZonedTime(
    new Date(zMonth.getFullYear(), zMonth.getMonth() + 2, 0, 23, 59, 59, 999),
    TZ
  );
  const monthStartYmd = ymdAmsterdam(monthStart);
  const monthEndYmd = ymdAmsterdam(monthEnd);
  const monthLines = expenseLines.filter(
    (l) => l.betaalDatum >= monthStartYmd && l.betaalDatum <= monthEndYmd
  );
  const twoWeekEnd = addDays(now, 13);
  const twoWeekStartYmd = ymdAmsterdam(now);
  const twoWeekEndYmd = ymdAmsterdam(twoWeekEnd);
  // 14d-kosten + eerstvolgende BTW-aangifte (ook als due net na 14d, bijv. 31 okt)
  const twoWeekCore = expenseLines.filter(
    (l) =>
      l.costPost !== "btw" &&
      l.betaalDatum >= twoWeekStartYmd &&
      l.betaalDatum <= twoWeekEndYmd
  );
  const btwStandLines = expenseLines.filter((l) => l.costPost === "btw");
  const twoWeekLines = [...twoWeekCore, ...btwStandLines];
  const expenseForecast: ExpenseForecast = {
    horizonLabel: `${WEEK_COUNT} weken vooruit`,
    monthLabel: `${formatInTimeZone(monthStart, TZ, "MMM")}–${formatInTimeZone(monthEnd, TZ, "MMM yyyy")}`,
    monthStart: monthStartYmd,
    monthEnd: monthEndYmd,
    monthTotaal: round2(monthLines.reduce((s, l) => s + l.bedrag, 0)),
    horizonTotaal: round2(expenseLines.reduce((s, l) => s + l.bedrag, 0)),
    byCostPost: groupExpenseLines(expenseLines),
    monthByCostPost: groupExpenseLines(monthLines),
    twoWeekByCostPost: groupExpenseLines(twoWeekLines),
    twoWeekTotaal: round2(twoWeekLines.reduce((s, l) => s + l.bedrag, 0)),
    twoWeekStart: twoWeekStartYmd,
    twoWeekEnd: twoWeekEndYmd,
    lines: expenseLines.sort((a, b) =>
      a.betaalDatum.localeCompare(b.betaalDatum)
    ),
  };

  return {
    omzetExBtw: round2(omzetExBtw),
    betaaldeOmzetExBtw: round2(betaaldeOmzetExBtw),
    inkomstenIncBtw: round2(inkomstenIncBtw),
    verwachteInkomsten5wIncBtw,
    verwachteWarmtefondsIncBtw: round2(verwachteWarmtefondsIncBtw),
    verwachteEigenMiddelenIncBtw: round2(verwachteEigenMiddelenIncBtw),
    verwachteDeals,
    afTeDragenBtw: round2(Math.max(afTeDragenBtw, btwKwartaalBedrag)),
    teBetalenInkoop5w: round2(teBetalenInkoop5w),
    teBetalenInstallatie: round2(teBetalenInstallatie),
    teBetalenSales: round2(teBetalenSales),
    teBetalenLoon: round2(teBetalenLoon),
    openstaandeFacturenIncBtw: round2(openstaandeFacturenIncBtw),
    openstaandeRestOrdersIncBtw: round2(openstaandeRestOrdersIncBtw),
    adSpendPeriode: round2(adSpendPeriode),
    freeCashflowProxy,
    beginsaldo,
    beginsaldoOntbreekt,
    btwTeBetalen: btwLock,
    btwKwartaalLabel: btwAangifte.label,
    btwBetaalDatum: btwAangifte.dueYmd,
    weeks,
    expenseForecast,
  };
}

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
  leadsForConversie: number,
  cohortAfspraken: number,
  cohortDeals: number
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
        ? round2((cohortAfspraken / leadsForConversie) * 100)
        : 0,
    conversieDeal:
      leadsForConversie > 0
        ? round2((cohortDeals / leadsForConversie) * 100)
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
  end: Date,
  commissieMap?: CommissieMap
): { slice: PeriodSlice; leadsForConversie: number; cohortAfspraken: number; cohortDeals: number } {
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
  const leadsMetDeal = new Set(signed.map((o) => o.lead_id));

  const slice = emptySlice();
  const periodLeadIds: string[] = [];

  for (const l of leads) {
    if (!inRange(l.created_at, start, end)) continue;
    slice.leads += 1;
    periodLeadIds.push(l.id);
  }
  const periodLeadSet = new Set(periodLeadIds);

  for (const a of afspraken) {
    if (!inRange(afspraakIngeplandAt(a), start, end)) continue;
    slice.brutoAfspraken += 1;
    if (a.status !== "geannuleerd") slice.nettoAfspraken += 1;
  }

  const cohortAfspraak = new Set<string>();
  for (const a of afspraken) {
    if (!periodLeadSet.has(a.lead_id)) continue;
    if (a.status === "geannuleerd") continue;
    cohortAfspraak.add(a.lead_id);
  }
  const cohortDeals = periodLeadIds.filter((id) => leadsMetDeal.has(id)).length;

  for (const o of signed) {
    if (!inRange(o.ondertekend_op!, start, end)) continue;
    slice.deals += 1;
    const omzet = Number(o.subtotaal_ex_btw) || 0;
    slice.omzet += omzet;
    const project = projecten.find((p) => p.offerte_id === o.id);
    const pk = Number(project?.projectkosten) || 0;
    slice.projectkosten += pk > 0 ? pk : STANDAARD_INSTALLATIEKOSTEN;
    slice.inkoop += hardwareKostenVoorRegels(o.regels || []).totaal;

    // Commissie als saleskosten
    if (commissieMap) {
      const advId = o.adviseur_id || project?.adviseur_id;
      if (advId) {
        const pct = commissieMap.get(advId) ?? 0;
        if (pct > 0) {
          slice.salesKosten += round2((omzet * pct) / 100);
        }
      }
    }
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

  return {
    slice,
    leadsForConversie: periodLeadIds.length,
    cohortAfspraken: cohortAfspraak.size,
    cohortDeals,
  };
}

function buildDailySeries(
  raw: RapportageRaw,
  kosten: RapportageKostenRow[],
  adviseurId: string | null,
  start: Date,
  end: Date,
  commissieMap?: CommissieMap
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
      dayEnd,
      commissieMap
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
  end: Date,
  commissieMap?: CommissieMap
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
    afspraakLeadIds.add(a.lead_id);
  }

  const dealLeadIds = new Set<string>();
  for (const o of raw.offertes) {
    if (o.status !== "ondertekend" || !o.ondertekend_op) continue;
    if (!leadMap.has(o.lead_id)) continue;
    dealLeadIds.add(o.lead_id);
  }

  type Acc = {
    leads: Set<string>;
    afspraken: Set<string>;
    dealLeads: Set<string>;
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
        dealLeads: new Set(),
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
    for (const [map, key] of [
      [byLander, lander] as const,
      [byAdv, adv] as const,
    ]) {
      const acc = ensure(map, key);
      acc.leads.add(l.id);
      if (afspraakLeadIds.has(l.id)) acc.afspraken.add(l.id);
      if (dealLeadIds.has(l.id)) {
        acc.dealLeads.add(l.id);
        acc.deals += 1;
      }
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
      acc.omzet += omzet;
      acc.inkoop += inkoop;
      acc.projectkosten += pk > 0 ? pk : STANDAARD_INSTALLATIEKOSTEN;
    }
  }

  function toRows(
    map: Map<string, Acc>,
    withCommissie: boolean
  ): FinancialBreakdownRow[] {
    return [...map.entries()]
      .map(([key, a]) => {
        let commissie = 0;
        if (withCommissie && commissieMap && key !== "(geen adviseur)") {
          const pct = commissieMap.get(key) ?? 0;
          if (pct > 0) commissie = round2((a.omzet * pct) / 100);
        }
        const winst = a.omzet - a.inkoop - a.projectkosten - commissie;
        return {
          key,
          label: key,
          leads: a.leads.size,
          afspraken: a.afspraken.size,
          deals: a.dealLeads.size,
          omzet: round2(a.omzet),
          winst: round2(winst),
          conversieDeal:
            a.leads.size > 0
              ? round2((a.dealLeads.size / a.leads.size) * 100)
              : 0,
        };
      })
      .sort((a, b) => b.omzet - a.omzet || b.leads - a.leads)
      .slice(0, 12);
  }

  return {
    byLander: toRows(byLander, false),
    byAdviseur: toRows(byAdv, true),
  };
}

export function buildFinancialDashboard(
  raw: RapportageRaw,
  kosten: RapportageKostenRow[],
  adviseurId: string | null,
  range: FinancialDateRange,
  now = new Date(),
  commissieMap?: CommissieMap,
  cashOpts?: {
    beginsaldoCash?: number | null;
    btwReservering?: number | null;
    tarikId?: string | null;
  }
): FinancialDashboardData {
  const { start, end, previousStart, previousEnd } = resolveFinancialRange(
    range,
    now
  );

  const current = computePeriodSlice(raw, kosten, adviseurId, start, end, commissieMap);
  const previous = computePeriodSlice(
    raw,
    kosten,
    adviseurId,
    previousStart,
    previousEnd,
    commissieMap
  );

  const totals = finalizeTotals(
    current.slice,
    current.leadsForConversie,
    current.cohortAfspraken,
    current.cohortDeals
  );
  const previousTotals = finalizeTotals(
    previous.slice,
    previous.leadsForConversie,
    previous.cohortAfspraken,
    previous.cohortDeals
  );
  const series = buildDailySeries(raw, kosten, adviseurId, start, end, commissieMap);
  const { byLander, byAdviseur } = buildBreakdowns(
    raw,
    adviseurId,
    start,
    end,
    commissieMap
  );
  const freeCashflow = buildFreeCashflow(
    raw,
    kosten,
    adviseurId,
    start,
    end,
    now,
    cashOpts,
    commissieMap
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
    freeCashflow,
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

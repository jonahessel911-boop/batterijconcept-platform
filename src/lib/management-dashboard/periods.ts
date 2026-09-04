/** Periodes, filters en defaults voor het managementdashboard. */

import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfQuarter,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subMonths,
  subWeeks,
} from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

const TZ = "Europe/Amsterdam";

export type MgmtPeriodPreset =
  | "today"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "last_30_days"
  | "this_quarter"
  | "this_year"
  | "custom";

export type MgmtFilters = {
  period: MgmtPeriodPreset;
  customStart?: string | null;
  customEnd?: string | null;
  comparePeriod?: MgmtPeriodPreset | "previous" | null;
  adviseurId?: string | null;
  leadbron?: string | null;
  campaign?: string | null;
  regio?: string | null;
  orderStatus?: string | null;
  installateurId?: string | null;
  productModel?: string | null;
  forecastLookbackDays?: 30 | 60 | 90;
};

export type ResolvedPeriod = {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  label: string;
  previousLabel: string;
};

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

export const PERIOD_PRESET_LABELS: Record<MgmtPeriodPreset, string> = {
  today: "Vandaag",
  this_week: "Deze week",
  last_week: "Vorige week",
  this_month: "Deze maand",
  last_month: "Vorige maand",
  last_30_days: "Afgelopen 30 dagen",
  this_quarter: "Dit kwartaal",
  this_year: "Dit jaar",
  custom: "Aangepaste periode",
};

export function resolveMgmtPeriod(
  filters: Pick<MgmtFilters, "period" | "customStart" | "customEnd">,
  now = new Date()
): ResolvedPeriod {
  const z = toZonedTime(now, TZ);
  let start: Date;
  let end = amsEndOfDay(now);

  switch (filters.period) {
    case "today":
      start = amsStartOfDay(now);
      break;
    case "this_week":
      start = amsStartOfDay(startOfWeek(z, { weekStartsOn: 1 }));
      break;
    case "last_week": {
      const thisMon = startOfWeek(z, { weekStartsOn: 1 });
      start = amsStartOfDay(subWeeks(thisMon, 1));
      end = amsEndOfDay(addDays(start, 6));
      break;
    }
    case "this_month":
      start = amsStartOfDay(startOfMonth(z));
      break;
    case "last_month": {
      const prev = subMonths(z, 1);
      start = amsStartOfDay(startOfMonth(prev));
      end = amsEndOfDay(endOfMonth(prev));
      break;
    }
    case "last_30_days":
      start = amsStartOfDay(addDays(z, -29));
      break;
    case "this_quarter":
      start = amsStartOfDay(startOfQuarter(z));
      end = amsEndOfDay(
        endOfQuarter(z).getTime() < now.getTime() ? endOfQuarter(z) : now
      );
      break;
    case "this_year":
      start = amsStartOfDay(startOfYear(z));
      break;
    case "custom": {
      if (filters.customStart && filters.customEnd) {
        start = amsStartOfDay(fromZonedTime(`${filters.customStart}T12:00:00`, TZ));
        end = amsEndOfDay(fromZonedTime(`${filters.customEnd}T12:00:00`, TZ));
      } else {
        start = amsStartOfDay(addDays(z, -29));
      }
      break;
    }
    default:
      start = amsStartOfDay(addDays(z, -29));
  }

  const days = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const previousEnd = amsEndOfDay(addDays(start, -1));
  const previousStart = amsStartOfDay(addDays(previousEnd, -(days - 1)));

  return {
    start,
    end,
    previousStart,
    previousEnd,
    label: PERIOD_PRESET_LABELS[filters.period] || "Periode",
    previousLabel: "Vorige vergelijkbare periode",
  };
}

/** Maand-tot-datum + rest van kalendermaand voor forecast. */
export function resolveMonthToDate(now = new Date()): {
  start: Date;
  end: Date;
  monthEnd: Date;
  daysElapsed: number;
  daysInMonth: number;
  daysRemaining: number;
} {
  const z = toZonedTime(now, TZ);
  const start = amsStartOfDay(startOfMonth(z));
  const end = amsEndOfDay(now);
  const monthEnd = amsEndOfDay(endOfMonth(z));
  const daysInMonth = differenceInCalendarDays(monthEnd, start) + 1;
  const daysElapsed = differenceInCalendarDays(end, start) + 1;
  return {
    start,
    end,
    monthEnd,
    daysElapsed,
    daysInMonth,
    daysRemaining: Math.max(0, daysInMonth - daysElapsed),
  };
}

export function inIsoRange(iso: string | null | undefined, start: Date, end: Date) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

export function inDateStrRange(
  dateStr: string | null | undefined,
  start: Date,
  end: Date
) {
  if (!dateStr) return false;
  const d = fromZonedTime(
    `${dateStr.slice(0, 10)}T12:00:00`,
    TZ
  );
  return d >= start && d <= end;
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function ceilInt(n: number) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}

export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) {
    if (current === 0) return null;
    return 100;
  }
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

export function safeDiv(a: number, b: number): number | null {
  if (!b) return null;
  return a / b;
}

export type DashboardInstellingen = {
  omzet_doel_maand: number;
  winst_doel_maand: number;
  minimale_marge_pct: number;
  max_cpl: number;
  max_kosten_per_afspraak: number;
  max_kosten_per_sale: number;
  doel_lead_to_appointment: number;
  doel_show_rate: number;
  doel_closing_rate: number;
  slots_per_adviseur_per_week: number;
  installaties_per_week: number;
  standaard_inkoop: number | null;
  standaard_installatie: number;
  verwachte_betaaltermijn_dagen: number;
  max_doorlooptijd_fase_dagen: number;
  forecast_lookback_dagen: 30 | 60 | 90;
  beginsaldo_cash: number | null;
  btw_reservering: number;
  meta_laatste_sync_at: string | null;
  meta_laatste_sync_until: string | null;
};

export const DEFAULT_INSTELLINGEN: DashboardInstellingen = {
  omzet_doel_maand: 150000,
  winst_doel_maand: 45000,
  minimale_marge_pct: 25,
  max_cpl: 75,
  max_kosten_per_afspraak: 250,
  max_kosten_per_sale: 1500,
  doel_lead_to_appointment: 35,
  doel_show_rate: 80,
  doel_closing_rate: 25,
  slots_per_adviseur_per_week: 24,
  installaties_per_week: 20,
  standaard_inkoop: null,
  standaard_installatie: 675,
  verwachte_betaaltermijn_dagen: 14,
  max_doorlooptijd_fase_dagen: 21,
  forecast_lookback_dagen: 60,
  beginsaldo_cash: null,
  btw_reservering: 0,
  meta_laatste_sync_at: null,
  meta_laatste_sync_until: null,
};

export function parseInstellingen(
  row: Record<string, unknown> | null | undefined
): DashboardInstellingen {
  if (!row) return { ...DEFAULT_INSTELLINGEN };
  const n = (k: string, fallback: number) => {
    const v = Number(row[k]);
    return Number.isFinite(v) ? v : fallback;
  };
  const lookback = n("forecast_lookback_dagen", 60);
  return {
    omzet_doel_maand: n("omzet_doel_maand", DEFAULT_INSTELLINGEN.omzet_doel_maand),
    winst_doel_maand: n("winst_doel_maand", DEFAULT_INSTELLINGEN.winst_doel_maand),
    minimale_marge_pct: n("minimale_marge_pct", DEFAULT_INSTELLINGEN.minimale_marge_pct),
    max_cpl: n("max_cpl", DEFAULT_INSTELLINGEN.max_cpl),
    max_kosten_per_afspraak: n(
      "max_kosten_per_afspraak",
      DEFAULT_INSTELLINGEN.max_kosten_per_afspraak
    ),
    max_kosten_per_sale: n(
      "max_kosten_per_sale",
      DEFAULT_INSTELLINGEN.max_kosten_per_sale
    ),
    doel_lead_to_appointment: n(
      "doel_lead_to_appointment",
      DEFAULT_INSTELLINGEN.doel_lead_to_appointment
    ),
    doel_show_rate: n("doel_show_rate", DEFAULT_INSTELLINGEN.doel_show_rate),
    doel_closing_rate: n("doel_closing_rate", DEFAULT_INSTELLINGEN.doel_closing_rate),
    slots_per_adviseur_per_week: Math.round(
      n("slots_per_adviseur_per_week", DEFAULT_INSTELLINGEN.slots_per_adviseur_per_week)
    ),
    installaties_per_week: Math.round(
      n("installaties_per_week", DEFAULT_INSTELLINGEN.installaties_per_week)
    ),
    standaard_inkoop:
      row.standaard_inkoop == null ? null : n("standaard_inkoop", 0),
    standaard_installatie: n(
      "standaard_installatie",
      DEFAULT_INSTELLINGEN.standaard_installatie
    ),
    verwachte_betaaltermijn_dagen: Math.round(
      n(
        "verwachte_betaaltermijn_dagen",
        DEFAULT_INSTELLINGEN.verwachte_betaaltermijn_dagen
      )
    ),
    max_doorlooptijd_fase_dagen: Math.round(
      n(
        "max_doorlooptijd_fase_dagen",
        DEFAULT_INSTELLINGEN.max_doorlooptijd_fase_dagen
      )
    ),
    forecast_lookback_dagen: ([30, 60, 90].includes(lookback)
      ? lookback
      : 60) as 30 | 60 | 90,
    beginsaldo_cash:
      row.beginsaldo_cash == null ? null : n("beginsaldo_cash", 0),
    btw_reservering: n("btw_reservering", 0),
    meta_laatste_sync_at: (row.meta_laatste_sync_at as string) || null,
    meta_laatste_sync_until: (row.meta_laatste_sync_until as string) || null,
  };
}

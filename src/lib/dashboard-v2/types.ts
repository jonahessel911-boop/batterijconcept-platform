import type { DashboardV2Goals } from "./goals";
import type { DashboardV2Forecast } from "./forecast";

export type DashboardV2Period =
  | "last_7_days"
  | "calendar_week"
  | "this_month"
  | "last_14_days"
  | "last_28_days"
  | "last_6_months"
  | "all"
  | "custom";

export type { DashboardV2Goals };

export type DashboardV2RangeOpts = {
  /** YYYY-MM-DD (Amsterdam), inclusive start 00:00 */
  from?: string | null;
  /** YYYY-MM-DD (Amsterdam), inclusive end 23:59:59 */
  to?: string | null;
  /** ISO-week `YYYY-Www` voor period=calendar_week */
  week?: string | null;
};

export type DashboardV2Scope = "team" | "adviseur" | "beller";

export type DashboardV2ScopeOpts = {
  scope?: DashboardV2Scope;
  personId?: string | null;
};

export type DashboardV2Bucket = {
  key: string;
  label: string;
  start: string;
  end: string;
  leads: number;
  afsprakenGepland: number;
  /** Afgeboekte huisbezoeken (uitkomst of vervolg; geen oranje “I”) */
  afsprakenVoltooid: number;
  /** Lead → afspraak % (eerste nieuw-afspraak / leads) */
  leadToAppt: number | null;
  /** Afspraak → sale % (orders / afgeboekte afspraken) */
  afspraakToSale: number | null;
  orders: number;
  omzet: number;
  /** Getekende orders die later geannuleerd zijn */
  annuleringen: number;
  /** annuleringen / (orders + annuleringen) × 100 */
  annuleringsPct: number | null;
  /** Omzet excl. btw van geannuleerde getekende orders */
  verlorenOmzet: number;
};

export type DashboardV2Totals = {
  leads: number;
  afsprakenGepland: number;
  afsprakenVoltooid: number;
  leadToAppt: number | null;
  afspraakToSale: number | null;
  orders: number;
  omzet: number;
  annuleringen: number;
  annuleringsPct: number | null;
  verlorenOmzet: number;
};

export type DashboardV2AdviseurBar = {
  id: string;
  naam: string;
  omzet: number;
  /** Omzetdoel voor de geselecteerde periode (omgerekend vanuit weekdoel) */
  omzetGoal: number;
  orders: number;
  afsprakenGepland: number;
  afsprakenVoltooid: number;
  /** Afspraak → sale % */
  afspraakToSale: number | null;
  annuleringen: number;
  annuleringsPct: number | null;
  /** 10% van omzet excl. btw */
  commissie: number;
  previousOmzet: number;
  deltaPct: number | null;
};

export type DashboardV2Data = {
  period: DashboardV2Period;
  periodLabel: string;
  previousLabel: string;
  granularity: "day" | "week" | "month";
  rangeStart: string;
  rangeEnd: string;
  /** YYYY-MM-DD voor UI date inputs */
  fromDate: string;
  toDate: string;
  /** ISO-week `YYYY-Www` als period=calendar_week */
  weekKey: string | null;
  dayCount: number;
  scope: DashboardV2Scope;
  personId: string | null;
  personNaam: string | null;
  buckets: DashboardV2Bucket[];
  totals: DashboardV2Totals;
  previous: DashboardV2Totals;
  deltas: {
    leads: number | null;
    afsprakenGepland: number | null;
    afsprakenVoltooid: number | null;
    leadToAppt: number | null;
    afspraakToSale: number | null;
    orders: number | null;
    omzet: number | null;
    annuleringen: number | null;
    annuleringsPct: number | null;
    verlorenOmzet: number | null;
  };
  goals: DashboardV2Goals;
  /** Ingevoerde weekdoelen (per 7 dagen) — voor de edit-popup */
  goalsWeekly: DashboardV2Goals;
  adviseurs: DashboardV2AdviseurBar[];
  /** Kiesbare personen voor scope-filter */
  people: { id: string; naam: string; rol: string }[];
  /** Laatste 3 ISO-weken + forecast-op-forecast vooruit */
  forecast: DashboardV2Forecast;
};

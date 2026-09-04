/** Types voor managementdashboard-output. */

import type { DashboardInstellingen, MgmtFilters } from "./periods";

export type SignalTone = "green" | "orange" | "red" | "neutral";
export type AlertSeverity = "kritiek" | "aandacht" | "positief";

export type DrilldownKind =
  | "leads"
  | "afspraken"
  | "offertes"
  | "projecten"
  | "facturen"
  | "deals"
  | "campaigns"
  | "adviseurs"
  | "none";

export type DrilldownRef = {
  kind: DrilldownKind;
  ids: string[];
  title: string;
};

export type MgmtKpi = {
  key: string;
  label: string;
  value: number | null;
  format: "money" | "number" | "percent" | "euro_per";
  target: number | null;
  vsTarget: number | null;
  deltaPct: number | null;
  tone: SignalTone;
  definition: string;
  missing?: string | null;
  drilldown: DrilldownRef;
};

export type MgmtAlert = {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  drilldown?: DrilldownRef;
};

export type MgmtFunnelStep = {
  key: string;
  label: string;
  count: number;
  conversionFromPrev: number | null;
  conversionFromLead: number | null;
  dropOff: number | null;
  avgDaysToNext: number | null;
  deltaPct: number | null;
  vsTarget: number | null;
  missing?: string | null;
  drilldown: DrilldownRef;
};

export type MgmtCampaignRow = {
  key: string;
  label: string;
  spend: number;
  leads: number;
  cpl: number | null;
  afsprakenGepland: number;
  kostenPerAfspraak: number | null;
  afsprakenUitgevoerd: number;
  deals: number;
  kostenPerSale: number | null;
  omzetGetekend: number;
  omzetBetaald: number;
  brutomarge: number | null;
  roas: number | null;
  leadToSale: number | null;
  annuleringsPct: number | null;
};

export type MgmtAdviseurCapacityWeek = {
  weekLabel: string;
  jaar: number;
  week: number;
  beschikbaar: boolean;
  slotsBeschikbaar: number;
  gepland: number;
  bevestigd: number;
  verwachtUitgevoerd: number;
  vrij: number;
  bezettingPct: number;
  benodigdeLeads: number;
  benodigdBudget: number | null;
};

export type MgmtAdviseurScore = {
  id: string;
  naam: string;
  leads: number;
  afsprakenGepland: number;
  afsprakenUitgevoerd: number;
  noShows: number;
  showRate: number | null;
  offertes: number;
  deals: number;
  closingPct: number | null;
  leadToSale: number | null;
  gemOrderwaarde: number | null;
  omzetGetekend: number;
  omzetGefactureerd: number;
  omzetBetaald: number;
  brutowinst: number | null;
  omzetPerAfspraak: number | null;
  kostenPerSale: number | null;
  annuleringsPct: number | null;
  capacity: MgmtAdviseurCapacityWeek[];
};

export type MgmtPipelinePhase = {
  key: string;
  label: string;
  count: number;
  orderwaarde: number;
  brutowinst: number | null;
  avgWaitDays: number | null;
  overdueCount: number;
  nextAction: string;
  missing?: string | null;
  drilldown: DrilldownRef;
};

export type MgmtAgingBucket = {
  key: string;
  label: string;
  count: number;
  bedrag: number;
  drilldown: DrilldownRef;
};

export type MgmtForecast = {
  omzetDoel: number;
  omzetGetekend: number;
  omzetGefactureerd: number;
  omzetBetaald: number;
  verwachteOmzetEindeMaand: number;
  verwachteBrutowinst: number | null;
  benodigdeDeals: number;
  benodigdeUitgevoerdeAfspraken: number;
  benodigdeGeplandeAfspraken: number;
  benodigdeLeads: number;
  benodigdAdBudget: number | null;
  kansPct: number | null;
  lookbackDays: 30 | 60 | 90;
  ratios: {
    gemOrderwaarde: number | null;
    appointmentToSale: number | null;
    showRate: number | null;
    leadToAppointment: number | null;
    cpl: number | null;
  };
  missing: string[];
};

export type MgmtFinanceOverview = {
  getekendeOrderwaarde: number;
  gefactureerdeOmzet: number;
  betaaldeOmzet: number;
  nogTeFactureren: number;
  openstaandeFacturen: number;
  achterstalligeFacturen: number;
  ontvangenAanbetalingen: number | null;
  resterendeBetalingen: number | null;
  gecrediteerd: number | null;
  terugbetalingen: number | null;
  verwachteBrutowinst: number;
  gerealiseerdeBrutowinst: number | null;
  btwOntvangen: number;
  btwAftrekbaar: number | null;
  btwNetto: number | null;
  btwReservering: number;
  btwTekortOverschot: number | null;
  aging: MgmtAgingBucket[];
  cashflow: {
    horizonDays: number;
    verwachteOntvangsten: number;
    verwachteInkoop: number | null;
    verwachteInstallatie: number | null;
    verwachteCommissie: number | null;
    verwachteAds: number | null;
    verwachteBtw: number | null;
    netto: number | null;
    eindsaldo: number | null;
    missing: string[];
  }[];
  missing: string[];
};

export type MgmtRisicoOmzet = {
  binnenBedenktijd: number | null;
  zonderFinanciering: number;
  zonderSchouwGo: number;
  noGoRisico: number | null;
  zonderInstallatiedatum: number;
  geinstalleerdNietBetaald: number;
  missing: string[];
};

export type MgmtMetaStatus = {
  configured: boolean;
  lastSyncAt: string | null;
  lastSyncUntil: string | null;
  stale: boolean;
  warning: string | null;
  totalSpendInPeriod: number;
  campaignRows: number;
};

export type ResolvedPeriodJson = {
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  label: string;
  previousLabel: string;
};

export type ManagementDashboardData = {
  filters: MgmtFilters;
  period: ResolvedPeriodJson;
  instellingen: DashboardInstellingen;
  meta: MgmtMetaStatus;
  directie: {
    kpis: MgmtKpi[];
    alerts: MgmtAlert[];
    forecast: MgmtForecast;
  };
  marketing: {
    kpis: MgmtKpi[];
    funnel: MgmtFunnelStep[];
    byBron: MgmtCampaignRow[];
    byCampaign: MgmtCampaignRow[];
  };
  sales: {
    adviseurs: MgmtAdviseurScore[];
    team: {
      gemShowRate: number | null;
      gemClosing: number | null;
      gemLeadToSale: number | null;
      vrijeSlots4Weken: number;
      benodigdeLeads4Weken: number;
      benodigdBudget4Weken: number | null;
    };
  };
  orders: {
    kpis: MgmtKpi[];
    pipeline: MgmtPipelinePhase[];
    risico: MgmtRisicoOmzet;
    capacity8Weken: {
      weekLabel: string;
      beschikbaar: number;
      gepland: number;
      verwachtNieuw: number;
      overOnder: number;
      omzetCapaciteit: number | null;
    }[];
  };
  finance: MgmtFinanceOverview;
  filterOptions: {
    adviseurs: { id: string; naam: string }[];
    leadbronnen: string[];
    campagnes: string[];
    regios: string[];
    orderStatuses: { id: string; label: string }[];
    installateurs: { id: string; naam: string }[];
    producten: string[];
  };
};

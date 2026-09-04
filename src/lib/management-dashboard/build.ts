/**
 * Centrale KPI-berekeningen voor het managementdashboard.
 * Alle bedragen excl. btw tenzij anders vermeld.
 * Geen dubbeltelling: getekend ≠ gefactureerd ≠ betaald.
 */

import { addDays, differenceInCalendarDays } from "date-fns";
import { factuurIsBetaald } from "@/lib/aanbetaling";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";
import {
  STANDAARD_INSTALLATIEKOSTEN,
  hardwareKostenVoorRegels,
} from "@/lib/project-kosten";
import { provincieVanPostcode } from "@/lib/postcode-provincie";
import { schouwWeekFromDate } from "@/lib/schouw-week";
import type {
  MgmtAdviseurCapacityWeek,
  MgmtAdviseurScore,
  MgmtAlert,
  MgmtCampaignRow,
  MgmtFinanceOverview,
  MgmtForecast,
  MgmtFunnelStep,
  MgmtKpi,
  MgmtMetaStatus,
  MgmtPipelinePhase,
  MgmtRisicoOmzet,
  ManagementDashboardData,
  SignalTone,
  DrilldownRef,
} from "./types";
import {
  DEFAULT_INSTELLINGEN,
  type DashboardInstellingen,
  type MgmtFilters,
  ceilInt,
  deltaPct,
  inDateStrRange,
  inIsoRange,
  resolveMgmtPeriod,
  resolveMonthToDate,
  round2,
  safeDiv,
} from "./periods";

export type MgmtLead = {
  id: string;
  created_at: string;
  status: string;
  adviseur_id: string | null;
  lander: string | null;
  campaign_name: string | null;
  ad_name: string | null;
  utm_campaign: string | null;
  postcode: string | null;
  plaats: string | null;
};

export type MgmtAfspraak = {
  id: string;
  lead_id: string;
  adviseur_id: string | null;
  start_at: string;
  created_at: string;
  status: string;
  soort: string | null;
};

export type MgmtOfferte = {
  id: string;
  lead_id: string;
  status: string;
  ondertekend_op: string | null;
  created_at: string;
  subtotaal_ex_btw: number;
  btw_bedrag?: number;
  adviseur_id: string | null;
  financiering_voorbehoud?: boolean | null;
  regels?: { omschrijving?: string | null; aantal?: number | null }[];
};

export type MgmtProject = {
  id: string;
  lead_id: string;
  offerte_id: string | null;
  created_at: string;
  status: string;
  projectkosten: number;
  adviseur_id: string | null;
  schouw_at?: string | null;
  schouw_jaar?: number | null;
  schouw_week?: number | null;
  installatie_at?: string | null;
  installatie_partner_id?: string | null;
  financiering_geschakeld_at?: string | null;
  monteur?: string | null;
};

export type MgmtFactuur = {
  id: string;
  lead_id: string;
  status: string;
  bedrag_ex_btw: number;
  btw_bedrag?: number;
  betaald_op: string | null;
  factuurdatum: string;
  vervaldatum?: string | null;
  adviseur_id: string | null;
};

export type MgmtKosten = {
  datum: string;
  soort: "ad_spend" | "sales";
  bedrag: number;
  adviseur_id: string | null;
};

export type MgmtMetaRow = {
  datum: string;
  level: string;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  spend: number;
};

export type MgmtBeschikbaarheid = {
  adviseur_id: string;
  jaar: number;
  week: number;
  beschikbaar: boolean;
};

export type MgmtRaw = {
  leads: MgmtLead[];
  afspraken: MgmtAfspraak[];
  offertes: MgmtOfferte[];
  allOffertes?: MgmtOfferte[];
  projecten: MgmtProject[];
  facturen: MgmtFactuur[];
  kosten: MgmtKosten[];
  metaSpend: MgmtMetaRow[];
  beschikbaarheid: MgmtBeschikbaarheid[];
  adviseurs: { id: string; naam: string; actief: boolean; commissie_pct?: number | null }[];
  installateurs: { id: string; naam: string }[];
};

function factuurBetaalIso(f: MgmtFactuur): string | null {
  if (f.status === "concept" || f.status === "vervallen") return null;
  if (!factuurIsBetaald(f.status, f.betaald_op)) return null;
  const raw = f.betaald_op || f.factuurdatum;
  if (!raw) return null;
  if (raw.length <= 10) return `${raw}T12:00:00+02:00`;
  return raw;
}

function dealAt(o: MgmtOfferte): string | null {
  if (o.status !== "ondertekend") return null;
  return o.ondertekend_op || o.created_at;
}

function leadMatchesFilters(l: MgmtLead, f: MgmtFilters): boolean {
  if (f.adviseurId && l.adviseur_id !== f.adviseurId) return false;
  if (f.leadbron) {
    const bron = (l.lander || "").trim() || "Onbekend";
    if (bron !== f.leadbron) return false;
  }
  if (f.campaign) {
    const c = (l.campaign_name || l.utm_campaign || "").trim() || "Onbekend";
    if (c !== f.campaign) return false;
  }
  if (f.regio) {
    const prov = provincieVanPostcode(l.postcode) || "Onbekend";
    if (prov !== f.regio) return false;
  }
  return true;
}

function toneVsTarget(
  value: number,
  target: number | null,
  higherIsBetter: boolean
): SignalTone {
  if (target == null || target === 0) return "neutral";
  const ratio = value / target;
  if (higherIsBetter) {
    if (ratio >= 1) return "green";
    if (ratio >= 0.85) return "orange";
    return "red";
  }
  if (ratio <= 1) return "green";
  if (ratio <= 1.15) return "orange";
  return "red";
}

function emptyDrill(title: string): DrilldownRef {
  return { kind: "none", ids: [], title };
}

function kpi(
  partial: Omit<MgmtKpi, "vsTarget" | "tone"> & {
    higherIsBetter?: boolean;
    tone?: SignalTone;
  }
): MgmtKpi {
  const vsTarget =
    partial.value != null && partial.target != null
      ? round2(partial.value - partial.target)
      : null;
  const tone =
    partial.tone ||
    (partial.missing
      ? "neutral"
      : toneVsTarget(
          partial.value ?? 0,
          partial.target,
          partial.higherIsBetter !== false
        ));
  return {
    key: partial.key,
    label: partial.label,
    value: partial.value,
    format: partial.format,
    target: partial.target,
    vsTarget,
    deltaPct: partial.deltaPct,
    tone,
    definition: partial.definition,
    missing: partial.missing ?? null,
    drilldown: partial.drilldown,
  };
}

type PeriodAgg = {
  leadIds: string[];
  leads: number;
  afsprakenBruto: number;
  afsprakenNetto: number;
  afsprakenGeplandIds: string[];
  afsprakenUitgevoerd: number;
  afsprakenUitgevoerdIds: string[];
  afsprakenBevestigd: number;
  noShows: number;
  offertesUitgebracht: number;
  offertesUitgebrachtIds: string[];
  deals: number;
  dealIds: string[];
  omzetGetekend: number;
  omzetGefactureerd: number;
  omzetBetaald: number;
  factuurIdsOpen: string[];
  factuurIdsBetaald: string[];
  openstaandeFacturen: number;
  btwOntvangen: number;
  inkoop: number;
  projectkosten: number;
  adSpend: number;
  salesKosten: number;
  dealOmzetten: number[];
};

function emptyAgg(): PeriodAgg {
  return {
    leadIds: [],
    leads: 0,
    afsprakenBruto: 0,
    afsprakenNetto: 0,
    afsprakenGeplandIds: [],
    afsprakenUitgevoerd: 0,
    afsprakenUitgevoerdIds: [],
    afsprakenBevestigd: 0,
    noShows: 0,
    offertesUitgebracht: 0,
    offertesUitgebrachtIds: [],
    deals: 0,
    dealIds: [],
    omzetGetekend: 0,
    omzetGefactureerd: 0,
    omzetBetaald: 0,
    factuurIdsOpen: [],
    factuurIdsBetaald: [],
    openstaandeFacturen: 0,
    btwOntvangen: 0,
    inkoop: 0,
    projectkosten: 0,
    adSpend: 0,
    salesKosten: 0,
    dealOmzetten: [],
  };
}

function projectKostenForDeal(
  o: MgmtOfferte,
  projectByOfferte: Map<string, MgmtProject>,
  standaardInstallatie: number
): number {
  const p = projectByOfferte.get(o.id);
  if (p && p.projectkosten > 0) return p.projectkosten;
  return standaardInstallatie || STANDAARD_INSTALLATIEKOSTEN;
}

function computeAgg(
  raw: MgmtRaw,
  filters: MgmtFilters,
  start: Date,
  end: Date,
  instellingen: DashboardInstellingen,
  commissieMap: Map<string, number>
): PeriodAgg {
  const agg = emptyAgg();
  const leadOk = (id: string) => {
    const l = raw.leads.find((x) => x.id === id);
    return l ? leadMatchesFilters(l, filters) : !filters.adviseurId && !filters.leadbron && !filters.campaign && !filters.regio;
  };

  const leads = raw.leads.filter(
    (l) => leadMatchesFilters(l, filters) && inIsoRange(l.created_at, start, end)
  );
  agg.leads = leads.length;
  agg.leadIds = leads.map((l) => l.id);

  const afspraken = raw.afspraken.filter((a) => {
    if (!afspraakBlokkeertAgenda(a.soort)) return false;
    if (filters.adviseurId && a.adviseur_id !== filters.adviseurId) return false;
    if (!leadOk(a.lead_id)) return false;
    const at = a.created_at || a.start_at;
    return inIsoRange(at, start, end);
  });
  agg.afsprakenBruto = afspraken.length;
  agg.afsprakenGeplandIds = afspraken.map((a) => a.id);
  const netto = afspraken.filter((a) => a.status !== "geannuleerd");
  agg.afsprakenNetto = netto.length;
  agg.afsprakenBevestigd = afspraken.filter(
    (a) => a.status === "bevestigd" || a.status === "voltooid"
  ).length;
  const uitgevoerd = afspraken.filter((a) => a.status === "voltooid");
  agg.afsprakenUitgevoerd = uitgevoerd.length;
  agg.afsprakenUitgevoerdIds = uitgevoerd.map((a) => a.id);
  agg.noShows = afspraken.filter(
    (a) => a.status === "geannuleerd" || a.status === "verzet"
  ).length;

  const allOff = raw.allOffertes || raw.offertes;
  const offertesPeriod = allOff.filter((o) => {
    if (filters.adviseurId && o.adviseur_id !== filters.adviseurId) return false;
    if (!leadOk(o.lead_id)) return false;
    return inIsoRange(o.created_at, start, end);
  });
  agg.offertesUitgebracht = offertesPeriod.filter(
    (o) => o.status === "verzonden" || o.status === "ondertekend"
  ).length;
  agg.offertesUitgebrachtIds = offertesPeriod
    .filter((o) => o.status === "verzonden" || o.status === "ondertekend")
    .map((o) => o.id);

  const projectByOfferte = new Map(
    raw.projecten.filter((p) => p.offerte_id).map((p) => [p.offerte_id!, p])
  );

  const deals = raw.offertes.filter((o) => {
    if (o.status !== "ondertekend") return false;
    if (filters.adviseurId && o.adviseur_id !== filters.adviseurId) return false;
    if (!leadOk(o.lead_id)) return false;
    if (filters.orderStatus) {
      const p = projectByOfferte.get(o.id);
      if (!p || p.status !== filters.orderStatus) return false;
    }
    if (filters.installateurId) {
      const p = projectByOfferte.get(o.id);
      if (!p || p.installatie_partner_id !== filters.installateurId) return false;
    }
    if (filters.productModel) {
      const hit = (o.regels || []).some((r) =>
        (r.omschrijving || "").toLowerCase().includes(filters.productModel!.toLowerCase())
      );
      if (!hit) return false;
    }
    const at = dealAt(o);
    return at ? inIsoRange(at, start, end) : false;
  });

  for (const o of deals) {
    const omzet = Number(o.subtotaal_ex_btw) || 0;
    agg.deals += 1;
    agg.dealIds.push(o.id);
    agg.omzetGetekend += omzet;
    agg.dealOmzetten.push(omzet);
    agg.inkoop += hardwareKostenVoorRegels(o.regels || []).totaal;
    agg.projectkosten += projectKostenForDeal(
      o,
      projectByOfferte,
      instellingen.standaard_installatie
    );
    const pct = o.adviseur_id ? commissieMap.get(o.adviseur_id) || 0 : 0;
    if (pct > 0) agg.salesKosten += (omzet * pct) / 100;
  }

  for (const f of raw.facturen) {
    if (filters.adviseurId && f.adviseur_id !== filters.adviseurId) continue;
    if (!leadOk(f.lead_id)) continue;
    if (f.status === "concept" || f.status === "vervallen") continue;
    const paidIso = factuurBetaalIso(f);
    if (paidIso && inIsoRange(paidIso, start, end)) {
      agg.omzetBetaald += Number(f.bedrag_ex_btw) || 0;
      agg.btwOntvangen += Number(f.btw_bedrag) || 0;
      agg.factuurIdsBetaald.push(f.id);
    }
    if (inDateStrRange(f.factuurdatum, start, end)) {
      agg.omzetGefactureerd += Number(f.bedrag_ex_btw) || 0;
    }
    if (
      !factuurIsBetaald(f.status, f.betaald_op) &&
      f.status !== "concept" &&
      f.status !== "vervallen"
    ) {
      agg.openstaandeFacturen += Number(f.bedrag_ex_btw) || 0;
      agg.factuurIdsOpen.push(f.id);
    }
  }

  for (const k of raw.kosten) {
    if (k.soort === "ad_spend") {
      if (filters.adviseurId) continue; // company-wide spend
      if (inDateStrRange(k.datum, start, end)) agg.adSpend += Number(k.bedrag) || 0;
    } else if (k.soort === "sales") {
      if (filters.adviseurId && k.adviseur_id !== filters.adviseurId) continue;
      if (inDateStrRange(k.datum, start, end)) agg.salesKosten += Number(k.bedrag) || 0;
    }
  }

  return agg;
}

function brutowinst(agg: PeriodAgg): number {
  return round2(
    agg.omzetGetekend -
      agg.inkoop -
      agg.projectkosten -
      agg.adSpend -
      agg.salesKosten
  );
}

function buildAlerts(opts: {
  agg: PeriodAgg;
  prev: PeriodAgg;
  forecast: MgmtForecast;
  sales: ManagementDashboardData["sales"];
  orders: ManagementDashboardData["orders"];
  finance: MgmtFinanceOverview;
  instellingen: DashboardInstellingen;
}): MgmtAlert[] {
  const alerts: MgmtAlert[] = [];
  const { agg, prev, forecast, sales, orders, finance, instellingen } = opts;

  const achterDoel = instellingen.omzet_doel_maand - forecast.omzetGetekend;
  if (achterDoel > 1000) {
    alerts.push({
      id: "omzet-achter",
      severity: "kritiek",
      title: `Je loopt ${formatMoney(achterDoel)} achter op het omzetdoel van deze maand.`,
      detail: `Doel ${formatMoney(instellingen.omzet_doel_maand)}, getekend ${formatMoney(forecast.omzetGetekend)}.`,
      drilldown: { kind: "deals", ids: [], title: "Getekende deals deze maand" },
    });
  }

  if (forecast.benodigdeLeads > 0) {
    alerts.push({
      id: "leads-nodig",
      severity: "aandacht",
      title: `Er zijn nog ${forecast.benodigdeLeads} leads nodig om het maandomzetdoel te halen.`,
      detail: `Op basis van lookback ${forecast.lookbackDays} dagen (conversies + CPL).`,
    });
  }

  if (sales.team.vrijeSlots4Weken > 0) {
    for (const a of sales.adviseurs) {
      const vrij = a.capacity.reduce((s, w) => s + w.vrij, 0);
      if (vrij >= 5) {
        alerts.push({
          id: `cap-${a.id}`,
          severity: "aandacht",
          title: `${a.naam} heeft de komende weken nog ${vrij} vrije afspraakslots.`,
          detail: `Benodigde leads ≈ ${a.capacity.reduce((s, w) => s + w.benodigdeLeads, 0)}.`,
          drilldown: { kind: "adviseurs", ids: [a.id], title: a.naam },
        });
      }
    }
  }

  const cps = safeDiv(agg.adSpend, agg.deals);
  const cpsPrev = safeDiv(prev.adSpend, prev.deals);
  if (cps != null && cpsPrev != null && cpsPrev > 0 && cps / cpsPrev > 1.2) {
    alerts.push({
      id: "cps-stijging",
      severity: "aandacht",
      title: `De kosten per sale zijn ${Math.round(((cps - cpsPrev) / cpsPrev) * 100)}% hoger dan vorige periode.`,
      detail: `Nu ${formatMoney(cps)} vs eerder ${formatMoney(cpsPrev)}.`,
    });
  }

  const open14 = finance.aging
    .filter((b) => b.key === "8_14" || b.key === "15_30" || b.key === "30_plus")
    .reduce((s, b) => s + b.bedrag, 0);
  if (open14 > 0) {
    alerts.push({
      id: "facturen-oud",
      severity: open14 > 20000 ? "kritiek" : "aandacht",
      title: `${formatMoney(open14)} aan facturen staat langer dan 7 dagen open.`,
      detail: "Zie Finance → ouderdom openstaande facturen.",
      drilldown: {
        kind: "facturen",
        ids: finance.aging.flatMap((b) => b.drilldown.ids),
        title: "Openstaande facturen",
      },
    });
  }

  const zonderInstall = orders.risico.zonderInstallatiedatum;
  if (zonderInstall > 0) {
    alerts.push({
      id: "geen-installatie",
      severity: "aandacht",
      title: `Er staat ${formatMoney(zonderInstall)} omzet zonder installatiedatum.`,
      detail: "Verkochte orders die operationeel nog gepland moeten worden.",
    });
  }

  const installAchterstand = orders.pipeline
    .filter((p) =>
      ["installatie_te_plannen", "installatie_gepland", "materiaal_besteld"].includes(
        p.key
      )
    )
    .reduce((s, p) => s + p.orderwaarde, 0);
  if (installAchterstand > 0) {
    alerts.push({
      id: "install-achterstand",
      severity: "aandacht",
      title: `De huidige installatiepijplijn vertegenwoordigt ${formatMoney(installAchterstand)} omzet.`,
      detail: "Nog te installeren getekende orders (excl. btw).",
    });
  }

  if (forecast.kansPct != null && forecast.kansPct >= 80) {
    alerts.push({
      id: "op-koers",
      severity: "positief",
      title: `Kans op maandomzetdoel ≈ ${Math.round(forecast.kansPct)}%.`,
      detail: `Verwachte eindstand ${formatMoney(forecast.verwachteOmzetEindeMaand)}.`,
    });
  }

  const order: Record<MgmtAlert["severity"], number> = {
    kritiek: 0,
    aandacht: 1,
    positief: 2,
  };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

function formatMoney(n: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function buildForecast(
  raw: MgmtRaw,
  filters: MgmtFilters,
  instellingen: DashboardInstellingen,
  commissieMap: Map<string, number>
): MgmtForecast {
  const mtd = resolveMonthToDate();
  const lookback = filters.forecastLookbackDays || instellingen.forecast_lookback_dagen;
  const lookEnd = mtd.end;
  const lookStart = addDays(lookEnd, -(lookback - 1));

  const monthAgg = computeAgg(
    raw,
    { ...filters, period: "this_month" },
    mtd.start,
    mtd.end,
    instellingen,
    commissieMap
  );
  const look = computeAgg(
    raw,
    filters,
    lookStart,
    lookEnd,
    instellingen,
    commissieMap
  );

  const gemOrderwaarde = safeDiv(look.omzetGetekend, look.deals);
  const appointmentToSale = safeDiv(look.deals, look.afsprakenUitgevoerd);
  const showRate = safeDiv(look.afsprakenUitgevoerd, look.afsprakenNetto);
  const leadToAppointment = safeDiv(look.afsprakenNetto, look.leads);
  const cpl = safeDiv(look.adSpend, look.leads);

  const pace =
    mtd.daysElapsed > 0
      ? (monthAgg.omzetGetekend / mtd.daysElapsed) * mtd.daysInMonth
      : monthAgg.omzetGetekend;

  const resterend = Math.max(0, instellingen.omzet_doel_maand - monthAgg.omzetGetekend);
  const benodigdeDeals =
    gemOrderwaarde && gemOrderwaarde > 0 ? ceilInt(resterend / gemOrderwaarde) : 0;
  const benodigdeUitgevoerdeAfspraken =
    appointmentToSale && appointmentToSale > 0
      ? ceilInt(benodigdeDeals / appointmentToSale)
      : 0;
  const benodigdeGeplandeAfspraken =
    showRate && showRate > 0
      ? ceilInt(benodigdeUitgevoerdeAfspraken / showRate)
      : 0;
  const benodigdeLeads =
    leadToAppointment && leadToAppointment > 0
      ? ceilInt(benodigdeGeplandeAfspraken / leadToAppointment)
      : 0;
  const benodigdAdBudget =
    cpl != null && benodigdeLeads > 0 ? round2(benodigdeLeads * cpl) : null;

  const missing: string[] = [];
  if (!gemOrderwaarde) missing.push("Gemiddelde orderwaarde (geen deals in lookback)");
  if (!appointmentToSale)
    missing.push("Afspraak→sale conversie (geen uitgevoerde afspraken)");
  if (!showRate) missing.push("Show-rate");
  if (!leadToAppointment) missing.push("Lead→afspraak conversie");
  if (cpl == null) missing.push("CPL (Meta ad spend of leads ontbreken)");

  const margePct =
    monthAgg.omzetGetekend > 0
      ? brutowinst(monthAgg) / monthAgg.omzetGetekend
      : look.omzetGetekend > 0
        ? brutowinst(look) / look.omzetGetekend
        : null;

  let kansPct: number | null = null;
  if (instellingen.omzet_doel_maand > 0) {
    kansPct = Math.min(100, Math.max(0, round2((pace / instellingen.omzet_doel_maand) * 100)));
  }

  return {
    omzetDoel: instellingen.omzet_doel_maand,
    omzetGetekend: round2(monthAgg.omzetGetekend),
    omzetGefactureerd: round2(monthAgg.omzetGefactureerd),
    omzetBetaald: round2(monthAgg.omzetBetaald),
    verwachteOmzetEindeMaand: round2(pace),
    verwachteBrutowinst:
      margePct != null ? round2(pace * margePct) : null,
    benodigdeDeals,
    benodigdeUitgevoerdeAfspraken,
    benodigdeGeplandeAfspraken,
    benodigdeLeads,
    benodigdAdBudget,
    kansPct,
    lookbackDays: lookback,
    ratios: {
      gemOrderwaarde: gemOrderwaarde != null ? round2(gemOrderwaarde) : null,
      appointmentToSale:
        appointmentToSale != null ? round2(appointmentToSale * 100) : null,
      showRate: showRate != null ? round2(showRate * 100) : null,
      leadToAppointment:
        leadToAppointment != null ? round2(leadToAppointment * 100) : null,
      cpl: cpl != null ? round2(cpl) : null,
    },
    missing,
  };
}

function campaignRowsFrom(
  raw: MgmtRaw,
  filters: MgmtFilters,
  start: Date,
  end: Date,
  group: "bron" | "campaign"
): MgmtCampaignRow[] {
  const map = new Map<
    string,
    {
      label: string;
      leadIds: Set<string>;
      dealOmzet: number;
      deals: number;
      paid: number;
      afspraak: number;
      uitgevoerd: number;
      cancelled: number;
      inkoop: number;
      projectkosten: number;
    }
  >();

  const keyOf = (l: MgmtLead) => {
    if (group === "bron") return (l.lander || "").trim() || "Onbekend";
    return (l.campaign_name || l.utm_campaign || "").trim() || "Onbekend";
  };

  for (const l of raw.leads) {
    if (!leadMatchesFilters(l, { ...filters, leadbron: null, campaign: null }))
      continue;
    if (!inIsoRange(l.created_at, start, end)) continue;
    const k = keyOf(l);
    if (!map.has(k)) {
      map.set(k, {
        label: k,
        leadIds: new Set(),
        dealOmzet: 0,
        deals: 0,
        paid: 0,
        afspraak: 0,
        uitgevoerd: 0,
        cancelled: 0,
        inkoop: 0,
        projectkosten: 0,
      });
    }
    map.get(k)!.leadIds.add(l.id);
  }

  const leadKey = new Map<string, string>();
  for (const l of raw.leads) leadKey.set(l.id, keyOf(l));

  for (const a of raw.afspraken) {
    if (!afspraakBlokkeertAgenda(a.soort)) continue;
    const k = leadKey.get(a.lead_id);
    if (!k || !map.has(k)) continue;
    if (!inIsoRange(a.created_at || a.start_at, start, end)) continue;
    const row = map.get(k)!;
    row.afspraak += 1;
    if (a.status === "voltooid") row.uitgevoerd += 1;
    if (a.status === "geannuleerd") row.cancelled += 1;
  }

  const projectByOfferte = new Map(
    raw.projecten.filter((p) => p.offerte_id).map((p) => [p.offerte_id!, p])
  );

  for (const o of raw.offertes) {
    if (o.status !== "ondertekend") continue;
    const k = leadKey.get(o.lead_id);
    if (!k || !map.has(k)) continue;
    const at = dealAt(o);
    if (!at || !inIsoRange(at, start, end)) continue;
    const row = map.get(k)!;
    const omzet = Number(o.subtotaal_ex_btw) || 0;
    row.deals += 1;
    row.dealOmzet += omzet;
    row.inkoop += hardwareKostenVoorRegels(o.regels || []).totaal;
    const p = projectByOfferte.get(o.id);
    row.projectkosten +=
      p && p.projectkosten > 0 ? p.projectkosten : STANDAARD_INSTALLATIEKOSTEN;
  }

  // Spend: prefer meta campaign rows; else distribute account spend not per campaign
  const spendByKey = new Map<string, number>();
  if (group === "campaign") {
    for (const m of raw.metaSpend) {
      if (m.level !== "campaign" && m.level !== "ad") continue;
      if (!inDateStrRange(m.datum, start, end)) continue;
      const name = (m.campaign_name || "").trim() || "Onbekend";
      spendByKey.set(name, (spendByKey.get(name) || 0) + (Number(m.spend) || 0));
    }
  }

  // Account-level ad spend for bron: not attributable → put under "Niet toegewezen"
  let totalAccountSpend = 0;
  for (const k of raw.kosten) {
    if (k.soort !== "ad_spend") continue;
    if (!inDateStrRange(k.datum, start, end)) continue;
    totalAccountSpend += Number(k.bedrag) || 0;
  }

  const rows: MgmtCampaignRow[] = [];
  for (const [key, row] of map) {
    let spend = spendByKey.get(key) || 0;
    if (group === "bron" && key === "Onbekend") {
      // leave 0 — attribution gap
    }
    const leads = row.leadIds.size;
    const marge = row.dealOmzet - row.inkoop - row.projectkosten - spend;
    rows.push({
      key,
      label: row.label,
      spend: round2(spend),
      leads,
      cpl: safeDiv(spend, leads) != null ? round2(spend / leads) : null,
      afsprakenGepland: row.afspraak,
      kostenPerAfspraak:
        row.afspraak > 0 ? round2(spend / row.afspraak) : null,
      afsprakenUitgevoerd: row.uitgevoerd,
      deals: row.deals,
      kostenPerSale: row.deals > 0 ? round2(spend / row.deals) : null,
      omzetGetekend: round2(row.dealOmzet),
      omzetBetaald: 0,
      brutomarge: round2(marge),
      roas: spend > 0 ? round2(row.dealOmzet / spend) : null,
      leadToSale: leads > 0 ? round2((row.deals / leads) * 100) : null,
      annuleringsPct:
        row.afspraak > 0
          ? round2((row.cancelled / row.afspraak) * 100)
          : null,
    });
  }

  if (group === "campaign" && spendByKey.size === 0 && totalAccountSpend > 0) {
    rows.push({
      key: "_account",
      label: "Meta account (niet per campagne gekoppeld)",
      spend: round2(totalAccountSpend),
      leads: 0,
      cpl: null,
      afsprakenGepland: 0,
      kostenPerAfspraak: null,
      afsprakenUitgevoerd: 0,
      deals: 0,
      kostenPerSale: null,
      omzetGetekend: 0,
      omzetBetaald: 0,
      brutomarge: null,
      roas: null,
      leadToSale: null,
      annuleringsPct: null,
    });
  }

  return rows.sort((a, b) => b.omzetGetekend - a.omzetGetekend || b.leads - a.leads);
}

function buildFunnel(
  agg: PeriodAgg,
  prev: PeriodAgg,
  raw: MgmtRaw,
  filters: MgmtFilters,
  start: Date,
  end: Date,
  instellingen: DashboardInstellingen
): MgmtFunnelStep[] {
  // Proxy-stappen waar we geen aparte events hebben
  const leadsReached = raw.leads.filter(
    (l) =>
      leadMatchesFilters(l, filters) &&
      inIsoRange(l.created_at, start, end) &&
      l.status !== "nieuw" &&
      l.status !== "geen_contact" &&
      l.status !== "foutief_nummer"
  ).length;
  const leadsBenaderd = raw.leads.filter(
    (l) =>
      leadMatchesFilters(l, filters) &&
      inIsoRange(l.created_at, start, end) &&
      l.status !== "nieuw"
  ).length;

  const finGoedgekeurd = raw.projecten.filter((p) => {
    if (!p.financiering_geschakeld_at) return false;
    if (filters.adviseurId && p.adviseur_id !== filters.adviseurId) return false;
    return inIsoRange(p.financiering_geschakeld_at, start, end);
  }).length;

  const schouwGo = raw.projecten.filter((p) => {
    if (filters.adviseurId && p.adviseur_id !== filters.adviseurId) return false;
    if (
      ![
        "btw_factuur_eruit",
        "product_ingekocht",
        "installatie_gepland",
        "installatie_voltooid",
        "service",
      ].includes(p.status)
    )
      return false;
    return inIsoRange(p.created_at, start, end);
  }).length;

  const installaties = raw.projecten.filter((p) => {
    if (p.status !== "installatie_voltooid" && !p.installatie_at) return false;
    if (filters.adviseurId && p.adviseur_id !== filters.adviseurId) return false;
    const at = p.installatie_at || p.created_at;
    return inIsoRange(at, start, end);
  }).length;

  const fullyPaidLeads = new Set(agg.factuurIdsBetaald.map((id) => {
    const f = raw.facturen.find((x) => x.id === id);
    return f?.lead_id;
  }));

  const steps: { key: string; label: string; count: number; missing?: string; ids: string[]; kind: DrilldownRef["kind"]; target?: number | null }[] = [
    {
      key: "leads",
      label: "Leads ontvangen",
      count: agg.leads,
      ids: agg.leadIds,
      kind: "leads",
    },
    {
      key: "benaderd",
      label: "Leads benaderd",
      count: leadsBenaderd,
      ids: [],
      kind: "leads",
      missing: "Proxy: status ≠ nieuw (geen bel-events)",
    },
    {
      key: "bereikt",
      label: "Leads bereikt",
      count: leadsReached,
      ids: [],
      kind: "leads",
      missing: "Proxy: status voorbij nieuw/geen_contact",
    },
    {
      key: "afspraak_gepland",
      label: "Afspraken gepland",
      count: agg.afsprakenBruto,
      ids: agg.afsprakenGeplandIds,
      kind: "afspraken",
      target: instellingen.doel_lead_to_appointment,
    },
    {
      key: "afspraak_bevestigd",
      label: "Afspraken bevestigd",
      count: agg.afsprakenBevestigd,
      ids: [],
      kind: "afspraken",
    },
    {
      key: "afspraak_uitgevoerd",
      label: "Afspraken uitgevoerd",
      count: agg.afsprakenUitgevoerd,
      ids: agg.afsprakenUitgevoerdIds,
      kind: "afspraken",
      target: instellingen.doel_show_rate,
    },
    {
      key: "offerte",
      label: "Offertes uitgebracht",
      count: agg.offertesUitgebracht,
      ids: agg.offertesUitgebrachtIds,
      kind: "offertes",
    },
    {
      key: "getekend",
      label: "Offertes getekend",
      count: agg.deals,
      ids: agg.dealIds,
      kind: "deals",
      target: instellingen.doel_closing_rate,
    },
    {
      key: "financiering",
      label: "Financieringen goedgekeurd",
      count: finGoedgekeurd,
      ids: [],
      kind: "projecten",
      missing: "Gebaseerd op financiering_geschakeld_at (proxy)",
    },
    {
      key: "schouw_go",
      label: "Schouwen goedgekeurd (GO)",
      count: schouwGo,
      ids: [],
      kind: "projecten",
      missing: "Proxy via projectstatus na schouw",
    },
    {
      key: "installatie",
      label: "Installaties uitgevoerd",
      count: installaties,
      ids: [],
      kind: "projecten",
    },
    {
      key: "betaald",
      label: "Orders volledig betaald",
      count: fullyPaidLeads.size,
      ids: [...fullyPaidLeads].filter(Boolean) as string[],
      kind: "facturen",
    },
  ];

  // prev counts for delta — simplified same structure length
  const prevCounts = [
    prev.leads,
    prev.leads,
    prev.leads,
    prev.afsprakenBruto,
    prev.afsprakenBevestigd,
    prev.afsprakenUitgevoerd,
    prev.offertesUitgebracht,
    prev.deals,
    0,
    0,
    0,
    prev.factuurIdsBetaald.length,
  ];

  const leadCount = steps[0].count || 1;
  return steps.map((s, i) => {
    const prevStep = i > 0 ? steps[i - 1].count : null;
    const conversionFromPrev =
      prevStep && prevStep > 0 ? round2((s.count / prevStep) * 100) : null;
    const conversionFromLead =
      agg.leads > 0 ? round2((s.count / leadCount) * 100) : null;
    const dropOff =
      prevStep != null ? Math.max(0, prevStep - s.count) : null;
    return {
      key: s.key,
      label: s.label,
      count: s.count,
      conversionFromPrev,
      conversionFromLead,
      dropOff,
      avgDaysToNext: null,
      deltaPct: deltaPct(s.count, prevCounts[i] || 0),
      vsTarget: s.target != null && conversionFromPrev != null
        ? round2(conversionFromPrev - s.target)
        : null,
      missing: s.missing,
      drilldown: {
        kind: s.kind,
        ids: s.ids,
        title: s.label,
      },
    };
  });
}

function buildSales(
  raw: MgmtRaw,
  filters: MgmtFilters,
  start: Date,
  end: Date,
  instellingen: DashboardInstellingen,
  commissieMap: Map<string, number>,
  cpl: number | null,
  teamLeadToAppt: number | null
): ManagementDashboardData["sales"] {
  const adviseurs = raw.adviseurs.filter((a) => a.actief);
  const scores: MgmtAdviseurScore[] = [];

  const now = new Date();
  const weeks: { jaar: number; week: number; label: string; start: Date }[] = [];
  for (let i = 0; i < 4; i++) {
    const d = addDays(now, i * 7);
    const info = schouwWeekFromDate(d);
    weeks.push({
      jaar: info.jaar,
      week: info.week,
      label: `W${info.week}`,
      start: d,
    });
  }

  for (const adv of adviseurs) {
    if (filters.adviseurId && adv.id !== filters.adviseurId) continue;
    const fAdv: MgmtFilters = { ...filters, adviseurId: adv.id };
    const agg = computeAgg(raw, fAdv, start, end, instellingen, commissieMap);
    const showRate = safeDiv(agg.afsprakenUitgevoerd, agg.afsprakenNetto);
    const closing = safeDiv(agg.deals, agg.afsprakenUitgevoerd);
    const leadToSale = safeDiv(agg.deals, agg.leads);
    const gemOrder = safeDiv(agg.omzetGetekend, agg.deals);

    const capacity: MgmtAdviseurCapacityWeek[] = weeks.map((w) => {
      const row = raw.beschikbaarheid.find(
        (b) =>
          b.adviseur_id === adv.id && b.jaar === w.jaar && b.week === w.week
      );
      const beschikbaar = row ? row.beschikbaar !== false : true;
      const slots = beschikbaar ? instellingen.slots_per_adviseur_per_week : 0;
      const weekStart = w.start;
      const weekEnd = addDays(weekStart, 6);
      const gepland = raw.afspraken.filter((a) => {
        if (a.adviseur_id !== adv.id) return false;
        if (!afspraakBlokkeertAgenda(a.soort)) return false;
        if (a.status === "geannuleerd") return false;
        return inIsoRange(a.start_at, weekStart, weekEnd);
      }).length;
      const bevestigd = raw.afspraken.filter((a) => {
        if (a.adviseur_id !== adv.id) return false;
        if (!afspraakBlokkeertAgenda(a.soort)) return false;
        if (a.status !== "bevestigd" && a.status !== "voltooid") return false;
        return inIsoRange(a.start_at, weekStart, weekEnd);
      }).length;
      const show = showRate ?? (teamLeadToAppt != null ? 0.8 : 0.8);
      const verwachtUitgevoerd = round2(bevestigd * (typeof show === "number" && show <= 1 ? show : show / 100) || gepland * 0.8);
      const vrij = Math.max(0, slots - gepland);
      const l2a = teamLeadToAppt && teamLeadToAppt > 0 ? teamLeadToAppt / 100 : 0.35;
      const benodigdeLeads = ceilInt(vrij / Math.max(l2a, 0.01));
      return {
        weekLabel: w.label,
        jaar: w.jaar,
        week: w.week,
        beschikbaar,
        slotsBeschikbaar: slots,
        gepland,
        bevestigd,
        verwachtUitgevoerd: Math.round(verwachtUitgevoerd),
        vrij,
        bezettingPct: slots > 0 ? round2((gepland / slots) * 100) : 0,
        benodigdeLeads,
        benodigdBudget: cpl != null ? round2(benodigdeLeads * cpl) : null,
      };
    });

    scores.push({
      id: adv.id,
      naam: adv.naam,
      leads: agg.leads,
      afsprakenGepland: agg.afsprakenBruto,
      afsprakenUitgevoerd: agg.afsprakenUitgevoerd,
      noShows: agg.noShows,
      showRate: showRate != null ? round2(showRate * 100) : null,
      offertes: agg.offertesUitgebracht,
      deals: agg.deals,
      closingPct: closing != null ? round2(closing * 100) : null,
      leadToSale: leadToSale != null ? round2(leadToSale * 100) : null,
      gemOrderwaarde: gemOrder != null ? round2(gemOrder) : null,
      omzetGetekend: round2(agg.omzetGetekend),
      omzetGefactureerd: round2(agg.omzetGefactureerd),
      omzetBetaald: round2(agg.omzetBetaald),
      brutowinst: round2(brutowinst(agg)),
      omzetPerAfspraak:
        agg.afsprakenUitgevoerd > 0
          ? round2(agg.omzetGetekend / agg.afsprakenUitgevoerd)
          : null,
      kostenPerSale:
        agg.deals > 0 && agg.adSpend === 0
          ? null
          : agg.deals > 0
            ? round2(agg.adSpend / agg.deals)
            : null,
      annuleringsPct:
        agg.afsprakenBruto > 0
          ? round2(
              ((agg.afsprakenBruto - agg.afsprakenNetto) / agg.afsprakenBruto) *
                100
            )
          : null,
      capacity,
    });
  }

  scores.sort((a, b) => b.omzetGetekend - a.omzetGetekend);

  const vrijeSlots4Weken = scores.reduce(
    (s, a) => s + a.capacity.reduce((x, w) => x + w.vrij, 0),
    0
  );
  const benodigdeLeads4Weken = scores.reduce(
    (s, a) => s + a.capacity.reduce((x, w) => x + w.benodigdeLeads, 0),
    0
  );

  const avg = (pick: (a: MgmtAdviseurScore) => number | null) => {
    const vals = scores.map(pick).filter((v): v is number => v != null);
    if (!vals.length) return null;
    return round2(vals.reduce((a, b) => a + b, 0) / vals.length);
  };

  return {
    adviseurs: scores,
    team: {
      gemShowRate: avg((a) => a.showRate),
      gemClosing: avg((a) => a.closingPct),
      gemLeadToSale: avg((a) => a.leadToSale),
      vrijeSlots4Weken,
      benodigdeLeads4Weken,
      benodigdBudget4Weken:
        cpl != null ? round2(benodigdeLeads4Weken * cpl) : null,
    },
  };
}

const PROJECT_PHASES: { key: string; label: string; match: (p: MgmtProject, o?: MgmtOfferte) => boolean; next: string }[] = [
  {
    key: "getekend",
    label: "Order getekend",
    match: (p) => p.status === "schouw_inplannen",
    next: "Schouw inplannen / bel klant",
  },
  {
    key: "bedenktijd",
    label: "Bedenktermijn actief",
    match: () => false,
    next: "Wachten op bedenktijd",
  },
  {
    key: "fin_aangevraagd",
    label: "Financiering aangevraagd",
    match: (p, o) =>
      Boolean(o?.financiering_voorbehoud) && !p.financiering_geschakeld_at,
    next: "Schakel financieringsman",
  },
  {
    key: "fin_goedgekeurd",
    label: "Financiering goedgekeurd",
    match: (p) => Boolean(p.financiering_geschakeld_at),
    next: "Schouw plannen",
  },
  {
    key: "schouw_vereist",
    label: "Schouw vereist",
    match: (p) => p.status === "schouw_inplannen" && !p.schouw_week,
    next: "Schouwweek zetten",
  },
  {
    key: "schouw_gepland",
    label: "Schouw gepland",
    match: (p) => p.status === "schouw_gepland" || Boolean(p.schouw_week),
    next: "Schouw uitvoeren",
  },
  {
    key: "schouw_uitgevoerd",
    label: "Schouw uitgevoerd",
    match: (p) => Boolean(p.schouw_at),
    next: "GO / NO-GO",
  },
  {
    key: "go",
    label: "GO",
    match: (p) =>
      ["btw_factuur_eruit", "product_ingekocht", "installatie_gepland"].includes(
        p.status
      ),
    next: "Materiaal / installatie",
  },
  {
    key: "nogo",
    label: "NO-GO",
    match: () => false,
    next: "Herplan of annuleer",
  },
  {
    key: "materiaal_besteld",
    label: "Materiaal besteld",
    match: (p) => p.status === "product_ingekocht",
    next: "Wachten op levering",
  },
  {
    key: "installatie_te_plannen",
    label: "Installatie te plannen",
    match: (p) =>
      p.status === "btw_factuur_eruit" ||
      (p.status === "product_ingekocht" && !p.installatie_at),
    next: "Installatiedatum zetten",
  },
  {
    key: "installatie_gepland",
    label: "Installatie gepland",
    match: (p) => p.status === "installatie_gepland" || Boolean(p.installatie_at),
    next: "Uitvoeren",
  },
  {
    key: "installatie_uitgevoerd",
    label: "Installatie uitgevoerd",
    match: (p) => p.status === "installatie_voltooid",
    next: "Factureren / nazorg",
  },
  {
    key: "service",
    label: "Garantie/nazorg",
    match: (p) => p.status === "service",
    next: "Afronden",
  },
];

function buildOrders(
  raw: MgmtRaw,
  filters: MgmtFilters,
  start: Date,
  end: Date,
  instellingen: DashboardInstellingen
): ManagementDashboardData["orders"] {
  const offerteById = new Map(raw.offertes.map((o) => [o.id, o]));
  const omzetOf = (p: MgmtProject) => {
    const o = p.offerte_id ? offerteById.get(p.offerte_id) : undefined;
    return o ? Number(o.subtotaal_ex_btw) || 0 : 0;
  };

  const projects = raw.projecten.filter((p) => {
    if (filters.adviseurId && p.adviseur_id !== filters.adviseurId) return false;
    if (filters.orderStatus && p.status !== filters.orderStatus) return false;
    if (filters.installateurId && p.installatie_partner_id !== filters.installateurId)
      return false;
    return true;
  });

  const pipeline: MgmtPipelinePhase[] = PROJECT_PHASES.map((phase) => {
    const matched = projects.filter((p) => {
      const o = p.offerte_id ? offerteById.get(p.offerte_id) : undefined;
      return phase.match(p, o);
    });
    const orderwaarde = matched.reduce((s, p) => s + omzetOf(p), 0);
    const overdue = matched.filter((p) => {
      const days = differenceInCalendarDays(new Date(), new Date(p.created_at));
      return days > instellingen.max_doorlooptijd_fase_dagen;
    }).length;
    const avgWait =
      matched.length > 0
        ? round2(
            matched.reduce(
              (s, p) =>
                s + differenceInCalendarDays(new Date(), new Date(p.created_at)),
              0
            ) / matched.length
          )
        : null;

    let missing: string | undefined;
    if (phase.key === "bedenktijd" || phase.key === "nogo") {
      missing = "Nog geen apart statusveld in de database";
    }

    return {
      key: phase.key,
      label: phase.label,
      count: matched.length,
      orderwaarde: round2(orderwaarde),
      brutowinst: null,
      avgWaitDays: avgWait,
      overdueCount: overdue,
      nextAction: phase.next,
      missing,
      drilldown: {
        kind: "projecten",
        ids: matched.map((p) => p.id),
        title: phase.label,
      },
    };
  });

  const zonderSchouw = projects.filter(
    (p) =>
      !p.schouw_at &&
      !p.schouw_week &&
      (p.status === "schouw_inplannen" || p.status === "schouw_gepland")
  );
  const zonderInstall = projects.filter(
    (p) =>
      !p.installatie_at &&
      p.status !== "installatie_voltooid" &&
      p.status !== "service"
  );
  const risico: MgmtRisicoOmzet = {
    binnenBedenktijd: null,
    zonderFinanciering: round2(
      projects
        .filter((p) => {
          const o = p.offerte_id ? offerteById.get(p.offerte_id) : undefined;
          return Boolean(o?.financiering_voorbehoud) && !p.financiering_geschakeld_at;
        })
        .reduce((s, p) => s + omzetOf(p), 0)
    ),
    zonderSchouwGo: round2(
      zonderSchouw.reduce((s, p) => s + omzetOf(p), 0)
    ),
    noGoRisico: null,
    zonderInstallatiedatum: round2(
      zonderInstall.reduce((s, p) => s + omzetOf(p), 0)
    ),
    geinstalleerdNietBetaald: round2(
      projects
        .filter((p) => p.status === "installatie_voltooid")
        .filter((p) => {
          const facts = raw.facturen.filter((f) => f.lead_id === p.lead_id);
          return !facts.some((f) => factuurIsBetaald(f.status, f.betaald_op));
        })
        .reduce((s, p) => s + omzetOf(p), 0)
    ),
    missing: [
      "Bedenktermijn: geen apart veld",
      "NO-GO: geen aparte status (alleen GO via doorstroom)",
    ],
  };

  const capacity8Weken = Array.from({ length: 8 }, (_, i) => {
    const d = addDays(new Date(), i * 7);
    const info = schouwWeekFromDate(d);
    const weekStart = d;
    const weekEnd = addDays(d, 6);
    const gepland = projects.filter(
      (p) => p.installatie_at && inIsoRange(p.installatie_at, weekStart, weekEnd)
    ).length;
    const beschikbaar = instellingen.installaties_per_week;
    const verwachtNieuw = Math.round(
      raw.offertes.filter((o) => {
        const at = dealAt(o);
        return at && inIsoRange(at, start, end);
      }).length / 4
    );
    return {
      weekLabel: `${info.jaar}-W${String(info.week).padStart(2, "0")}`,
      beschikbaar,
      gepland,
      verwachtNieuw,
      overOnder: beschikbaar - gepland - verwachtNieuw,
      omzetCapaciteit: null,
    };
  });

  const kpis: MgmtKpi[] = [
    kpi({
      key: "zonder_schouw",
      label: "Orders zonder schouwdatum",
      value: zonderSchouw.length,
      format: "number",
      target: 0,
      deltaPct: null,
      higherIsBetter: false,
      definition: "Projecten in schouw-fase zonder schouwweek/datum.",
      drilldown: {
        kind: "projecten",
        ids: zonderSchouw.map((p) => p.id),
        title: "Zonder schouw",
      },
    }),
    kpi({
      key: "zonder_install",
      label: "Orders zonder installatiedatum",
      value: zonderInstall.length,
      format: "number",
      target: 0,
      deltaPct: null,
      higherIsBetter: false,
      definition: "Actieve projecten zonder installatie_at.",
      drilldown: {
        kind: "projecten",
        ids: zonderInstall.map((p) => p.id),
        title: "Zonder installatie",
      },
    }),
    kpi({
      key: "omzet_te_installeren",
      label: "Omzet nog te installeren",
      value: risico.zonderInstallatiedatum,
      format: "money",
      target: null,
      deltaPct: null,
      definition: "Som getekende omzet (excl. btw) zonder installatiedatum.",
      drilldown: emptyDrill("Omzet te installeren"),
    }),
  ];

  return { kpis, pipeline, risico, capacity8Weken };
}

function buildFinance(
  raw: MgmtRaw,
  filters: MgmtFilters,
  start: Date,
  end: Date,
  agg: PeriodAgg,
  instellingen: DashboardInstellingen
): MgmtFinanceOverview {
  const now = new Date();
  const open = raw.facturen.filter((f) => {
    if (f.status === "concept" || f.status === "vervallen") return false;
    if (factuurIsBetaald(f.status, f.betaald_op)) return false;
    if (filters.adviseurId && f.adviseur_id !== filters.adviseurId) return false;
    return true;
  });

  const agingKeys: {
    key: string;
    label: string;
    match: (daysLate: number) => boolean;
  }[] = [
    { key: "not_due", label: "Nog niet vervallen", match: (d) => d <= 0 },
    { key: "1_7", label: "1–7 dagen te laat", match: (d) => d >= 1 && d <= 7 },
    { key: "8_14", label: "8–14 dagen te laat", match: (d) => d >= 8 && d <= 14 },
    {
      key: "15_30",
      label: "15–30 dagen te laat",
      match: (d) => d >= 15 && d <= 30,
    },
    {
      key: "30_plus",
      label: "Meer dan 30 dagen te laat",
      match: (d) => d > 30,
    },
  ];

  const aging = agingKeys.map((b) => {
    const ids: string[] = [];
    let bedrag = 0;
    for (const f of open) {
      const due = f.vervaldatum
        ? new Date(f.vervaldatum)
        : addDays(
            new Date(f.factuurdatum),
            instellingen.verwachte_betaaltermijn_dagen
          );
      const daysLate = differenceInCalendarDays(now, due);
      if (!b.match(daysLate)) continue;
      ids.push(f.id);
      bedrag += Number(f.bedrag_ex_btw) || 0;
    }
    return {
      key: b.key,
      label: b.label,
      count: ids.length,
      bedrag: round2(bedrag),
      drilldown: {
        kind: "facturen" as const,
        ids,
        title: b.label,
      },
    };
  });

  const achterstallig = aging
    .filter((a) => a.key !== "not_due")
    .reduce((s, a) => s + a.bedrag, 0);

  const missing = [
    ...(instellingen.beginsaldo_cash == null
      ? ["Beginsaldo cash (Instellingen dashboard)"]
      : []),
    "Aftrekbare btw inkoop: geen volledige inkoopfacturen-koppeling",
    "Creditnota's / terugbetalingen: nog geen apart overzicht",
    "Aanbetalingen als aparte cashflow: deels via facturen",
  ];

  const cashflow = [7, 30, 60, 90].map((horizonDays) => {
    const horizonEnd = addDays(now, horizonDays);
    const verwachteOntvangsten = open
      .filter((f) => {
        const due = f.vervaldatum
          ? new Date(f.vervaldatum)
          : addDays(
              new Date(f.factuurdatum),
              instellingen.verwachte_betaaltermijn_dagen
            );
        return due <= horizonEnd;
      })
      .reduce((s, f) => s + (Number(f.bedrag_ex_btw) || 0), 0);

    return {
      horizonDays,
      verwachteOntvangsten: round2(verwachteOntvangsten),
      verwachteInkoop: null as number | null,
      verwachteInstallatie: null as number | null,
      verwachteCommissie: null as number | null,
      verwachteAds: null as number | null,
      verwachteBtw: null as number | null,
      netto: null as number | null,
      eindsaldo:
        instellingen.beginsaldo_cash != null
          ? round2(instellingen.beginsaldo_cash + verwachteOntvangsten)
          : null,
      missing: [
        "Uitgaande cashflow (inkoop/installatie/ads/commissie) niet volledig voorspelbaar zonder planningstabellen",
      ],
    };
  });

  const winst = brutowinst(agg);

  return {
    getekendeOrderwaarde: round2(agg.omzetGetekend),
    gefactureerdeOmzet: round2(agg.omzetGefactureerd),
    betaaldeOmzet: round2(agg.omzetBetaald),
    nogTeFactureren: round2(
      Math.max(0, agg.omzetGetekend - agg.omzetGefactureerd)
    ),
    openstaandeFacturen: round2(agg.openstaandeFacturen),
    achterstalligeFacturen: round2(achterstallig),
    ontvangenAanbetalingen: null,
    resterendeBetalingen: null,
    gecrediteerd: null,
    terugbetalingen: null,
    verwachteBrutowinst: winst,
    gerealiseerdeBrutowinst: null,
    btwOntvangen: round2(agg.btwOntvangen),
    btwAftrekbaar: null,
    btwNetto: null,
    btwReservering: instellingen.btw_reservering,
    btwTekortOverschot:
      agg.btwOntvangen > 0
        ? round2(instellingen.btw_reservering - agg.btwOntvangen)
        : null,
    aging,
    cashflow,
    missing,
  };
}

export function buildManagementDashboard(
  raw: MgmtRaw,
  filters: MgmtFilters,
  instellingen: DashboardInstellingen = DEFAULT_INSTELLINGEN,
  metaConfigured = false
): ManagementDashboardData {
  const period = resolveMgmtPeriod(filters);
  const commissieMap = new Map<string, number>();
  for (const a of raw.adviseurs) {
    const pct = Number(a.commissie_pct) || 0;
    if (pct > 0) commissieMap.set(a.id, pct);
  }

  const agg = computeAgg(
    raw,
    filters,
    period.start,
    period.end,
    instellingen,
    commissieMap
  );
  const prev = computeAgg(
    raw,
    filters,
    period.previousStart,
    period.previousEnd,
    instellingen,
    commissieMap
  );

  const gemDeal = safeDiv(agg.omzetGetekend, agg.deals);
  const winst = brutowinst(agg);
  const prevWinst = brutowinst(prev);
  const btwAfdracht =
    agg.btwOntvangen > 0 ? round2(agg.btwOntvangen) : null;

  const directieKpis: MgmtKpi[] = [
    kpi({
      key: "leads",
      label: "Nieuwe leads",
      value: agg.leads,
      format: "number",
      target: null,
      deltaPct: deltaPct(agg.leads, prev.leads),
      definition: "Leads met created_at in de geselecteerde periode.",
      drilldown: { kind: "leads", ids: agg.leadIds, title: "Nieuwe leads" },
    }),
    kpi({
      key: "deals",
      label: "Getekende deals",
      value: agg.deals,
      format: "number",
      target: null,
      deltaPct: deltaPct(agg.deals, prev.deals),
      definition: "Offertes met status ondertekend (op ondertekend_op).",
      drilldown: { kind: "deals", ids: agg.dealIds, title: "Getekende deals" },
    }),
    kpi({
      key: "omzet_getekend",
      label: "Getekende omzet excl. btw",
      value: round2(agg.omzetGetekend),
      format: "money",
      target:
        filters.period === "this_month" || filters.period === "last_month"
          ? instellingen.omzet_doel_maand
          : null,
      deltaPct: deltaPct(agg.omzetGetekend, prev.omzetGetekend),
      definition: "Som subtotaal_ex_btw van getekende offertes in de periode.",
      drilldown: { kind: "deals", ids: agg.dealIds, title: "Getekende omzet" },
    }),
    kpi({
      key: "omzet_gefactureerd",
      label: "Gefactureerde omzet",
      value: round2(agg.omzetGefactureerd),
      format: "money",
      target: null,
      deltaPct: deltaPct(agg.omzetGefactureerd, prev.omzetGefactureerd),
      definition: "Som bedrag_ex_btw van facturen op factuurdatum in de periode.",
      drilldown: { kind: "facturen", ids: [], title: "Gefactureerd" },
    }),
    kpi({
      key: "omzet_betaald",
      label: "Betaalde omzet",
      value: round2(agg.omzetBetaald),
      format: "money",
      target: null,
      deltaPct: deltaPct(agg.omzetBetaald, prev.omzetBetaald),
      definition: "Som bedrag_ex_btw van betaalde facturen (betaald_op).",
      drilldown: {
        kind: "facturen",
        ids: agg.factuurIdsBetaald,
        title: "Betaald",
      },
    }),
    kpi({
      key: "brutowinst",
      label: "Verwachte brutowinst",
      value: winst,
      format: "money",
      target:
        filters.period === "this_month" ? instellingen.winst_doel_maand : null,
      deltaPct: deltaPct(winst, prevWinst),
      definition:
        "Getekende omzet − inkoop − installatie − ad spend − saleskosten (excl. btw).",
      drilldown: emptyDrill("Brutowinst"),
    }),
    kpi({
      key: "aov",
      label: "Gemiddelde orderwaarde",
      value: gemDeal != null ? round2(gemDeal) : null,
      format: "money",
      target: null,
      deltaPct: deltaPct(gemDeal || 0, safeDiv(prev.omzetGetekend, prev.deals) || 0),
      definition: "Getekende omzet / aantal deals.",
      missing: gemDeal == null ? "Geen deals in periode" : null,
      drilldown: { kind: "deals", ids: agg.dealIds, title: "Deals" },
    }),
    kpi({
      key: "open_facturen",
      label: "Openstaande facturen",
      value: round2(agg.openstaandeFacturen),
      format: "money",
      target: 0,
      deltaPct: null,
      higherIsBetter: false,
      definition: "Niet-betaalde facturen (excl. concept/vervallen), excl. btw.",
      drilldown: {
        kind: "facturen",
        ids: agg.factuurIdsOpen,
        title: "Openstaand",
      },
    }),
    kpi({
      key: "btw",
      label: "Verwachte btw-afdracht",
      value: btwAfdracht,
      format: "money",
      target: null,
      deltaPct: null,
      definition: "Btw op betaalde verkoopfacturen in de periode (nog zonder inkoop-btw).",
      missing:
        btwAfdracht == null
          ? "Geen betaalde facturen met btw_bedrag in periode"
          : "Aftrekbare inkoop-btw ontbreekt nog",
      drilldown: emptyDrill("BTW"),
    }),
    kpi({
      key: "cash",
      label: "Beschikbare cash",
      value: instellingen.beginsaldo_cash,
      format: "money",
      target: null,
      deltaPct: null,
      definition: "Handmatig beginsaldo uit dashboardinstellingen.",
      missing:
        instellingen.beginsaldo_cash == null
          ? "Koppeling: vul beginsaldo_cash in bij dashboardinstellingen"
          : null,
      drilldown: emptyDrill("Cash"),
      tone: "neutral",
    }),
  ];

  const forecast = buildForecast(raw, filters, instellingen, commissieMap);
  const cpl = safeDiv(agg.adSpend, agg.leads);
  const leadToAppt = safeDiv(agg.afsprakenNetto, agg.leads);

  const marketingKpis: MgmtKpi[] = [
    kpi({
      key: "ad_spend",
      label: "Meta-advertentie-uitgaven",
      value: round2(agg.adSpend),
      format: "money",
      target: null,
      deltaPct: deltaPct(agg.adSpend, prev.adSpend),
      definition: "Som rapportage_kosten soort=ad_spend (Meta sync).",
      missing: agg.adSpend === 0 ? "Geen Meta spend in periode — sync of check env" : null,
      drilldown: emptyDrill("Ad spend"),
    }),
    kpi({
      key: "overig_ads",
      label: "Overige advertentie-uitgaven",
      value: null,
      format: "money",
      target: null,
      deltaPct: null,
      definition: "Nog geen aparte bron voor non-Meta ads.",
      missing: "Voeg handmatig toe via rapportage_kosten of nieuwe bron",
      drilldown: emptyDrill("Overig"),
      tone: "neutral",
    }),
    kpi({
      key: "cpl",
      label: "Kosten per lead (CPL)",
      value: cpl != null ? round2(cpl) : null,
      format: "euro_per",
      target: instellingen.max_cpl,
      deltaPct: deltaPct(cpl || 0, safeDiv(prev.adSpend, prev.leads) || 0),
      higherIsBetter: false,
      definition: "Advertentie-uitgaven / aantal leads.",
      missing: cpl == null ? "Geen spend of leads" : null,
      drilldown: { kind: "leads", ids: agg.leadIds, title: "Leads" },
    }),
    kpi({
      key: "cps",
      label: "Kosten per getekende sale",
      value: safeDiv(agg.adSpend, agg.deals) != null ? round2(agg.adSpend / agg.deals) : null,
      format: "euro_per",
      target: instellingen.max_kosten_per_sale,
      deltaPct: deltaPct(
        safeDiv(agg.adSpend, agg.deals) || 0,
        safeDiv(prev.adSpend, prev.deals) || 0
      ),
      higherIsBetter: false,
      definition: "Advertentie-uitgaven / getekende deals.",
      missing: agg.deals === 0 ? "Geen deals" : null,
      drilldown: { kind: "deals", ids: agg.dealIds, title: "Deals" },
    }),
    kpi({
      key: "roas",
      label: "ROAS getekend",
      value:
        agg.adSpend > 0 ? round2(agg.omzetGetekend / agg.adSpend) : null,
      format: "number",
      target: null,
      deltaPct: null,
      definition: "Getekende omzet / advertentie-uitgaven.",
      missing: agg.adSpend === 0 ? "Geen ad spend" : null,
      drilldown: emptyDrill("ROAS"),
    }),
    kpi({
      key: "l2a",
      label: "Lead-to-appointment",
      value: leadToAppt != null ? round2(leadToAppt * 100) : null,
      format: "percent",
      target: instellingen.doel_lead_to_appointment,
      deltaPct: deltaPct(
        (leadToAppt || 0) * 100,
        (safeDiv(prev.afsprakenNetto, prev.leads) || 0) * 100
      ),
      definition: "Netto afspraken / leads × 100.",
      drilldown: {
        kind: "afspraken",
        ids: agg.afsprakenGeplandIds,
        title: "Afspraken",
      },
    }),
    kpi({
      key: "show",
      label: "Show-rate",
      value:
        safeDiv(agg.afsprakenUitgevoerd, agg.afsprakenNetto) != null
          ? round2((agg.afsprakenUitgevoerd / agg.afsprakenNetto) * 100)
          : null,
      format: "percent",
      target: instellingen.doel_show_rate,
      deltaPct: null,
      definition: "Uitgevoerde afspraken / netto geplande afspraken.",
      drilldown: {
        kind: "afspraken",
        ids: agg.afsprakenUitgevoerdIds,
        title: "Uitgevoerd",
      },
    }),
    kpi({
      key: "a2s",
      label: "Appointment-to-sale",
      value:
        safeDiv(agg.deals, agg.afsprakenUitgevoerd) != null
          ? round2((agg.deals / agg.afsprakenUitgevoerd) * 100)
          : null,
      format: "percent",
      target: instellingen.doel_closing_rate,
      deltaPct: null,
      definition: "Deals / uitgevoerde afspraken.",
      drilldown: { kind: "deals", ids: agg.dealIds, title: "Deals" },
    }),
    kpi({
      key: "l2s",
      label: "Lead-to-sale",
      value:
        safeDiv(agg.deals, agg.leads) != null
          ? round2((agg.deals / agg.leads) * 100)
          : null,
      format: "percent",
      target: null,
      deltaPct: deltaPct(
        (safeDiv(agg.deals, agg.leads) || 0) * 100,
        (safeDiv(prev.deals, prev.leads) || 0) * 100
      ),
      definition: "Deals / leads × 100.",
      drilldown: { kind: "deals", ids: agg.dealIds, title: "Deals" },
    }),
  ];

  const sales = buildSales(
    raw,
    filters,
    period.start,
    period.end,
    instellingen,
    commissieMap,
    cpl != null ? round2(cpl) : null,
    leadToAppt != null ? round2(leadToAppt * 100) : null
  );
  const orders = buildOrders(
    raw,
    filters,
    period.start,
    period.end,
    instellingen
  );
  const finance = buildFinance(
    raw,
    filters,
    period.start,
    period.end,
    agg,
    instellingen
  );
  const funnel = buildFunnel(
    agg,
    prev,
    raw,
    filters,
    period.start,
    period.end,
    instellingen
  );

  const alerts = buildAlerts({
    agg,
    prev,
    forecast,
    sales,
    orders,
    finance,
    instellingen,
  });

  const metaCampaignCount = raw.metaSpend.filter((m) =>
    inDateStrRange(m.datum, period.start, period.end)
  ).length;

  let metaWarning: string | null = null;
  let stale = false;
  if (!metaConfigured) {
    metaWarning = "Meta Ads niet geconfigureerd (META_AD_ACCOUNT_ID / token).";
  } else if (!instellingen.meta_laatste_sync_at) {
    metaWarning = "Nog geen succesvolle Meta-sync geregistreerd.";
    stale = true;
  } else {
    const ageH =
      (Date.now() - new Date(instellingen.meta_laatste_sync_at).getTime()) /
      3600000;
    if (ageH > 48) {
      stale = true;
      metaWarning = `Meta-data mogelijk verouderd (laatste sync ${Math.round(ageH)}u geleden).`;
    }
  }

  const meta: MgmtMetaStatus = {
    configured: metaConfigured,
    lastSyncAt: instellingen.meta_laatste_sync_at,
    lastSyncUntil: instellingen.meta_laatste_sync_until,
    stale,
    warning: metaWarning,
    totalSpendInPeriod: round2(agg.adSpend),
    campaignRows: metaCampaignCount,
  };

  const leadbronnen = [
    ...new Set(
      raw.leads.map((l) => (l.lander || "").trim() || "Onbekend").filter(Boolean)
    ),
  ].sort();
  const campagnes = [
    ...new Set(
      raw.leads
        .map((l) => (l.campaign_name || l.utm_campaign || "").trim())
        .filter(Boolean) as string[]
    ),
  ].sort();
  const regios = [
    ...new Set(
      raw.leads
        .map((l) => provincieVanPostcode(l.postcode))
        .filter(Boolean) as string[]
    ),
  ].sort();
  const producten = [
    ...new Set(
      raw.offertes.flatMap((o) =>
        (o.regels || [])
          .map((r) => (r.omschrijving || "").trim())
          .filter(Boolean)
      )
    ),
  ]
    .slice(0, 40)
    .sort();

  return {
    filters,
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      previousStart: period.previousStart.toISOString(),
      previousEnd: period.previousEnd.toISOString(),
      label: period.label,
      previousLabel: period.previousLabel,
    },
    instellingen,
    meta,
    directie: { kpis: directieKpis, alerts, forecast },
    marketing: {
      kpis: marketingKpis,
      funnel,
      byBron: campaignRowsFrom(raw, filters, period.start, period.end, "bron"),
      byCampaign: campaignRowsFrom(
        raw,
        filters,
        period.start,
        period.end,
        "campaign"
      ),
    },
    sales,
    orders,
    finance,
    filterOptions: {
      adviseurs: raw.adviseurs
        .filter((a) => a.actief)
        .map((a) => ({ id: a.id, naam: a.naam })),
      leadbronnen,
      campagnes,
      regios,
      orderStatuses: [
        { id: "schouw_inplannen", label: "Schouw inplannen" },
        { id: "schouwweek_gepland", label: "Schouwweek gepland" },
        { id: "schouwdag_plannen", label: "Schouwdag plannen" },
        { id: "schouw_gepland", label: "Schouwdag gepland" },
        { id: "materiaal_inkopen", label: "Materiaal inkopen" },
        { id: "btw_factuur_eruit", label: "BTW-factuur" },
        { id: "product_ingekocht", label: "Product ingekocht" },
        { id: "installatie_gepland", label: "Installatie gepland" },
        { id: "installatie_voltooid", label: "Installatie voltooid" },
        { id: "service", label: "Service" },
      ],
      installateurs: raw.installateurs,
      producten,
    },
  };
}

/** @deprecated period is already ISO strings */
export function serializeManagementDashboard(
  data: ManagementDashboardData
): ManagementDashboardData {
  return data;
}

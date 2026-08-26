import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  endOfWeek,
  getISOWeek,
  startOfWeek,
} from "date-fns";
import { nl } from "date-fns/locale";
import { STANDAARD_INSTALLATIEKOSTEN, hardwareKostenVoorRegels } from "@/lib/project-kosten";
import { factuurIsBetaald } from "@/lib/aanbetaling";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";

const TZ = "Europe/Amsterdam";

function amsStartOfDay(year: number, month1: number, day: number): Date {
  return fromZonedTime(new Date(year, month1 - 1, day, 0, 0, 0, 0), TZ);
}

function amsEndOfDay(year: number, month1: number, day: number): Date {
  return fromZonedTime(new Date(year, month1 - 1, day, 23, 59, 59, 999), TZ);
}

function amsStartOfMonth(year: number, month1: number): Date {
  return amsStartOfDay(year, month1, 1);
}

function amsEndOfMonth(year: number, month1: number): Date {
  const last = new Date(year, month1, 0).getDate();
  return amsEndOfDay(year, month1, last);
}

function amsStartOfYear(year: number): Date {
  return amsStartOfDay(year, 1, 1);
}

function amsEndOfYear(year: number): Date {
  return amsEndOfDay(year, 12, 31);
}

function amsYmd(d: Date) {
  return {
    y: Number(formatInTimeZone(d, TZ, "yyyy")),
    m: Number(formatInTimeZone(d, TZ, "M")),
    d: Number(formatInTimeZone(d, TZ, "d")),
  };
}

export type RapportageMetrics = {
  leads: number;
  /**
   * Unieke leads van niet-geannuleerde fysieke afspraken die in deze
   * periode zijn ingepland (afspraak.created_at). Basis Lead → afspraak.
   */
  afspraken: number;
  /** Fysieke afspraken ingepland in de periode (op created_at), incl. geannuleerd. */
  brutoAfspraken: number;
  /** Ingeplande afspraken die niet geannuleerd zijn. */
  nettoAfspraken: number;
  /** Geannuleerd ÷ bruto, in procenten. */
  uitvalPct: number;
  deals: number;
  conversieAfspraak: number;
  conversieDeal: number;
  omzetExBtw: number;
  projectkosten: number;
  inkoop: number;
  omzet: number;
  betaaldeOmzet: number;
  winst: number;
};

export type RapportageNode = {
  key: string;
  level: "year" | "month" | "week" | "day";
  label: string;
  start: string;
  end: string;
  isCurrent: boolean;
  metrics: RapportageMetrics;
  children?: RapportageNode[];
};

export function emptyMetrics(): RapportageMetrics {
  return {
    leads: 0,
    afspraken: 0,
    brutoAfspraken: 0,
    nettoAfspraken: 0,
    uitvalPct: 0,
    deals: 0,
    conversieAfspraak: 0,
    conversieDeal: 0,
    omzetExBtw: 0,
    projectkosten: 0,
    inkoop: 0,
    omzet: 0,
    betaaldeOmzet: 0,
    winst: 0,
  };
}

export function finalizeMetrics(m: RapportageMetrics): RapportageMetrics {
  const omzet = round2(m.omzetExBtw);
  const winst = round2(m.omzetExBtw - m.projectkosten - m.inkoop);
  return {
    ...m,
    omzetExBtw: round2(m.omzetExBtw),
    projectkosten: round2(m.projectkosten),
    inkoop: round2(m.inkoop),
    omzet,
    betaaldeOmzet: round2(m.betaaldeOmzet),
    winst,
    conversieAfspraak:
      m.leads > 0 ? Math.round((m.afspraken / m.leads) * 1000) / 10 : 0,
    conversieDeal:
      m.leads > 0 ? Math.round((m.deals / m.leads) * 1000) / 10 : 0,
    uitvalPct:
      m.brutoAfspraken > 0
        ? Math.round(
            ((m.brutoAfspraken - m.nettoAfspraken) / m.brutoAfspraken) * 1000
          ) / 10
        : 0,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function addMetrics(a: RapportageMetrics, b: RapportageMetrics): RapportageMetrics {
  return {
    leads: a.leads + b.leads,
    afspraken: a.afspraken + b.afspraken,
    brutoAfspraken: a.brutoAfspraken + b.brutoAfspraken,
    nettoAfspraken: a.nettoAfspraken + b.nettoAfspraken,
    uitvalPct: 0,
    deals: a.deals + b.deals,
    conversieAfspraak: 0,
    conversieDeal: 0,
    omzetExBtw: a.omzetExBtw + b.omzetExBtw,
    projectkosten: a.projectkosten + b.projectkosten,
    inkoop: a.inkoop + b.inkoop,
    omzet: 0,
    betaaldeOmzet: a.betaaldeOmzet + b.betaaldeOmzet,
    winst: 0,
  };
}

function dayKey(d: Date) {
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}

function inRange(iso: string, start: Date, end: Date) {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t <= end.getTime();
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

export type RapportageLead = {
  id: string;
  created_at: string;
  status: string;
  adviseur_id: string | null;
  lander?: string | null;
  campaign_name?: string | null;
  utm_campaign?: string | null;
};

export type RapportageRaw = {
  leads: RapportageLead[];
  afspraken: {
    id: string;
    lead_id: string;
    adviseur_id: string | null;
    start_at: string;
    /** Moment waarop de beller de afspraak inplande. */
    created_at: string;
    status: string;
    soort?: string | null;
  }[];
  offertes: {
    id: string;
    lead_id: string;
    status: string;
    ondertekend_op: string | null;
    created_at: string;
    subtotaal_ex_btw: number;
    adviseur_id: string | null;
    regels?: { omschrijving?: string | null; aantal?: number | null }[];
  }[];
  projecten: {
    id: string;
    lead_id: string;
    offerte_id: string | null;
    created_at: string;
    projectkosten: number;
    adviseur_id: string | null;
  }[];
  facturen: {
    id: string;
    lead_id: string;
    status: string;
    bedrag_ex_btw: number;
    betaald_op: string | null;
    factuurdatum: string;
    adviseur_id: string | null;
  }[];
};

/** Compacte metrics voor lander/campaign-attributie (cohort). */
export type AttributionMetrics = {
  leads: number;
  /** Unieke leads met ≥1 niet-geannuleerde fysieke afspraak. */
  afspraken: number;
  /** Ondertekende offertes van leads in deze groep. */
  deals: number;
  conversieAfspraak: number;
  conversieDeal: number;
};

export type AttributionNode = {
  key: string;
  level: "lander" | "campaign";
  label: string;
  metrics: AttributionMetrics;
  children?: AttributionNode[];
};

const GEEN_LANDER = "(geen lander)";
const GEEN_CAMPAIGN = "(geen campaign)";

function normalizeAttr(value: string | null | undefined, fallback: string): string {
  const t = (value || "").trim();
  return t || fallback;
}

function leadCampaign(lead: RapportageLead): string {
  return normalizeAttr(
    lead.campaign_name || lead.utm_campaign,
    GEEN_CAMPAIGN
  );
}

function leadLander(lead: RapportageLead): string {
  return normalizeAttr(lead.lander, GEEN_LANDER);
}

function emptyAttribution(): AttributionMetrics {
  return {
    leads: 0,
    afspraken: 0,
    deals: 0,
    conversieAfspraak: 0,
    conversieDeal: 0,
  };
}

function finalizeAttribution(m: AttributionMetrics): AttributionMetrics {
  return {
    ...m,
    conversieAfspraak:
      m.leads > 0 ? Math.round((m.afspraken / m.leads) * 1000) / 10 : 0,
    conversieDeal:
      m.leads > 0 ? Math.round((m.deals / m.leads) * 1000) / 10 : 0,
  };
}

/**
 * Cohort-attributie: lander → campaign.
 * Leads in de groep; afspraken = unieke leads met netto fysieke afspraak;
 * deals = ondertekende offertes van die leads.
 */
export function buildAttributionTree(
  raw: RapportageRaw,
  adviseurId: string | null
): AttributionNode[] {
  const leads = adviseurId
    ? raw.leads.filter((l) => l.adviseur_id === adviseurId)
    : raw.leads;
  const leadIds = new Set(leads.map((l) => l.id));

  const afspraakLeadIds = new Set<string>();
  for (const a of raw.afspraken) {
    if (!leadIds.has(a.lead_id)) continue;
    if (!afspraakBlokkeertAgenda(a.soort)) continue;
    if (a.status === "geannuleerd") continue;
    afspraakLeadIds.add(a.lead_id);
  }

  const signed = raw.offertes.filter(
    (o) =>
      o.status === "ondertekend" &&
      o.ondertekend_op &&
      leadIds.has(o.lead_id)
  );
  const dealCounts = new Map<string, number>();
  for (const o of signed) {
    dealCounts.set(o.lead_id, (dealCounts.get(o.lead_id) || 0) + 1);
  }

  type Bucket = {
    leadIds: string[];
    afspraakLeads: Set<string>;
    dealLeads: Set<string>;
    deals: number;
  };

  const byLander = new Map<string, Map<string, Bucket>>();

  for (const lead of leads) {
    const lander = leadLander(lead);
    const campaign = leadCampaign(lead);
    let campaigns = byLander.get(lander);
    if (!campaigns) {
      campaigns = new Map();
      byLander.set(lander, campaigns);
    }
    let bucket = campaigns.get(campaign);
    if (!bucket) {
      bucket = {
        leadIds: [],
        afspraakLeads: new Set(),
        dealLeads: new Set(),
        deals: 0,
      };
      campaigns.set(campaign, bucket);
    }
    bucket.leadIds.push(lead.id);
    if (afspraakLeadIds.has(lead.id)) bucket.afspraakLeads.add(lead.id);
    const nDeals = dealCounts.get(lead.id) || 0;
    if (nDeals > 0) {
      bucket.dealLeads.add(lead.id);
      bucket.deals += nDeals;
    }
  }

  function metricsFromBucket(b: Bucket): AttributionMetrics {
    const m = emptyAttribution();
    m.leads = b.leadIds.length;
    m.afspraken = b.afspraakLeads.size;
    m.deals = b.deals;
    const out = finalizeAttribution(m);
    out.conversieDeal =
      b.leadIds.length > 0
        ? Math.round((b.dealLeads.size / b.leadIds.length) * 1000) / 10
        : 0;
    return out;
  }

  const landers = [...byLander.entries()].sort((a, b) => {
    const leadsA = [...a[1].values()].reduce((s, x) => s + x.leadIds.length, 0);
    const leadsB = [...b[1].values()].reduce((s, x) => s + x.leadIds.length, 0);
    if (leadsB !== leadsA) return leadsB - leadsA;
    return a[0].localeCompare(b[0], "nl");
  });

  return landers.map(([lander, campaigns]) => {
    const campaignEntries = [...campaigns.entries()].sort((a, b) => {
      if (b[1].leadIds.length !== a[1].leadIds.length) {
        return b[1].leadIds.length - a[1].leadIds.length;
      }
      return a[0].localeCompare(b[0], "nl");
    });

    const children: AttributionNode[] = campaignEntries.map(
      ([campaign, bucket]) => ({
        key: `campaign:${lander}::${campaign}`,
        level: "campaign" as const,
        label: campaign,
        metrics: metricsFromBucket(bucket),
      })
    );

    const landerBucket: Bucket = {
      leadIds: [],
      afspraakLeads: new Set(),
      dealLeads: new Set(),
      deals: 0,
    };
    for (const [, b] of campaignEntries) {
      landerBucket.leadIds.push(...b.leadIds);
      for (const id of b.afspraakLeads) landerBucket.afspraakLeads.add(id);
      for (const id of b.dealLeads) landerBucket.dealLeads.add(id);
      landerBucket.deals += b.deals;
    }

    return {
      key: `lander:${lander}`,
      level: "lander" as const,
      label: lander,
      metrics: metricsFromBucket(landerBucket),
      children,
    };
  });
}

/** Tijdstip waarop de afspraak is ingepland (beller-prestatie), niet de afspraakdatum. */
function afspraakIngeplandAt(a: {
  created_at?: string | null;
  start_at: string;
}): string {
  return a.created_at || a.start_at;
}

export function buildRapportageTree(
  raw: RapportageRaw,
  adviseurId: string | null
): RapportageNode[] {
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

  const now = new Date();
  const nowParts = amsYmd(now);

  // Rapportage t/m vandaag: afspraken tellen op inplandatum, niet op
  // toekomstige bezoekdatum — geen horizon-extensie meer nodig.
  const horizon = now;
  const horizonParts = nowParts;

  const years = new Map<number, true>();

  for (const l of leads) {
    years.set(Number(formatInTimeZone(l.created_at, TZ, "yyyy")), true);
  }
  for (const a of afspraken) {
    years.set(
      Number(formatInTimeZone(afspraakIngeplandAt(a), TZ, "yyyy")),
      true
    );
  }
  for (const o of signed) {
    years.set(Number(formatInTimeZone(o.ondertekend_op!, TZ, "yyyy")), true);
  }
  for (const f of facturen) {
    const iso = factuurBetaalIso(f);
    if (!iso) continue;
    years.set(Number(formatInTimeZone(iso, TZ, "yyyy")), true);
  }
  years.set(nowParts.y, true);

  const yearList = [...years.keys()].sort((a, b) => b - a);

  /** Leads met ondertekende offerte (voor Lead → deal cohort). */
  const leadsMetDeal = new Set(signed.map((o) => o.lead_id));

  function metricsFor(start: Date, end: Date): RapportageMetrics {
    const m = emptyMetrics();
    const periodLeadIds: string[] = [];
    for (const l of leads) {
      if (!inRange(l.created_at, start, end)) continue;
      m.leads += 1;
      periodLeadIds.push(l.id);
    }

    // Volume + Lead→afspraak: moment dat de afspraak is INGEPLAND
    const afspraakLeads = new Set<string>();
    for (const a of afspraken) {
      if (!inRange(afspraakIngeplandAt(a), start, end)) continue;
      m.brutoAfspraken += 1;
      if (a.status !== "geannuleerd") {
        m.nettoAfspraken += 1;
        afspraakLeads.add(a.lead_id);
      }
    }
    m.afspraken = afspraakLeads.size;

    const cohortDeals = periodLeadIds.filter((id) =>
      leadsMetDeal.has(id)
    ).length;

    for (const o of signed) {
      if (!inRange(o.ondertekend_op!, start, end)) continue;
      m.deals += 1;
      m.omzetExBtw += Number(o.subtotaal_ex_btw) || 0;
      const project = projecten.find((p) => p.offerte_id === o.id);
      const kosten = Number(project?.projectkosten) || 0;
      m.projectkosten +=
        kosten > 0 ? kosten : STANDAARD_INSTALLATIEKOSTEN;
      m.inkoop += hardwareKostenVoorRegels(o.regels || []).totaal;
    }
    for (const f of facturen) {
      const iso = factuurBetaalIso(f);
      if (!iso || !inRange(iso, start, end)) continue;
      m.betaaldeOmzet += Number(f.bedrag_ex_btw) || 0;
    }

    const out = finalizeMetrics(m);
    out.conversieDeal =
      m.leads > 0
        ? Math.round((cohortDeals / m.leads) * 1000) / 10
        : 0;
    return out;
  }

  return yearList.map((year) => {
    const yStart = amsStartOfYear(year);
    const yEnd =
      year === horizonParts.y
        ? amsEndOfDay(horizonParts.y, horizonParts.m, horizonParts.d)
        : amsEndOfYear(year);
    const months: RapportageNode[] = [];
    const lastMonth = year === horizonParts.y ? horizonParts.m : 12;

    for (let month1 = 1; month1 <= lastMonth; month1++) {
      const mStart = amsStartOfMonth(year, month1);
      const mEndRaw = amsEndOfMonth(year, month1);
      const mEnd =
        year === horizonParts.y && month1 === horizonParts.m
          ? yEnd
          : mEndRaw;

      const weeks: RapportageNode[] = [];
      const localMonthStart = toZonedTime(mStart, TZ);
      let cursor = startOfWeek(localMonthStart, { weekStartsOn: 1 });
      const localMonthEnd = toZonedTime(mEnd, TZ);

      while (cursor <= localMonthEnd) {
        const cursorParts = {
          y: cursor.getFullYear(),
          m: cursor.getMonth() + 1,
          d: cursor.getDate(),
        };
        const weekStartLocal = cursor < localMonthStart ? localMonthStart : cursor;
        const weekEndLocalRaw = endOfWeek(cursor, { weekStartsOn: 1 });
        const weekEndLocal =
          weekEndLocalRaw > localMonthEnd ? localMonthEnd : weekEndLocalRaw;

        const wStart = amsStartOfDay(
          weekStartLocal.getFullYear(),
          weekStartLocal.getMonth() + 1,
          weekStartLocal.getDate()
        );
        let wEnd = amsEndOfDay(
          weekEndLocal.getFullYear(),
          weekEndLocal.getMonth() + 1,
          weekEndLocal.getDate()
        );
        if (wEnd > mEnd) wEnd = mEnd;

        if (wStart <= horizon) {
          const days: RapportageNode[] = [];
          let dCursor = new Date(weekStartLocal);
          while (dCursor <= weekEndLocal) {
            const dp = {
              y: dCursor.getFullYear(),
              m: dCursor.getMonth() + 1,
              d: dCursor.getDate(),
            };
            const dStart = amsStartOfDay(dp.y, dp.m, dp.d);
            let dEnd = amsEndOfDay(dp.y, dp.m, dp.d);
            if (dEnd > mEnd) dEnd = mEnd;
            if (dStart <= horizon) {
              const label = formatInTimeZone(dStart, TZ, "EEE d MMM", {
                locale: nl,
              });
              days.push({
                key: `day-${dayKey(dStart)}`,
                level: "day",
                label,
                start: dStart.toISOString(),
                end: dEnd.toISOString(),
                isCurrent: dayKey(dStart) === dayKey(now),
                metrics: metricsFor(dStart, dEnd),
              });
            }
            dCursor = new Date(
              dCursor.getFullYear(),
              dCursor.getMonth(),
              dCursor.getDate() + 1
            );
          }
          days.reverse();
          const weekNum = getISOWeek(cursor);
          const weekLabel = `W${weekNum} · ${formatInTimeZone(wStart, TZ, "d MMM", { locale: nl })} – ${formatInTimeZone(wEnd, TZ, "d MMM", { locale: nl })}`;
          weeks.push({
            key: `week-${year}-W${weekNum}-${dayKey(wStart)}`,
            level: "week",
            label: weekLabel,
            start: wStart.toISOString(),
            end: wEnd.toISOString(),
            isCurrent: now >= wStart && now <= wEnd,
            metrics: metricsFor(wStart, wEnd),
            children: days,
          });
        }

        cursor = new Date(
          cursorParts.y,
          cursorParts.m - 1,
          cursorParts.d + 7
        );
      }

      months.push({
        key: `month-${year}-${String(month1).padStart(2, "0")}`,
        level: "month",
        label: `${year}-${String(month1).padStart(2, "0")}`,
        start: mStart.toISOString(),
        end: mEnd.toISOString(),
        isCurrent: nowParts.y === year && nowParts.m === month1,
        metrics: metricsFor(mStart, mEnd),
        children: weeks,
      });
    }

    return {
      key: `year-${year}`,
      level: "year" as const,
      label: String(year),
      start: yStart.toISOString(),
      end: yEnd.toISOString(),
      isCurrent: nowParts.y === year,
      metrics: metricsFor(yStart, yEnd),
      children: months,
    };
  });
}

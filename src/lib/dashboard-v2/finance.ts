/**
 * Financiële staafgrafiek voor Dashboard V2:
 * Omzet · Saleskosten · Inkoopkosten · Leadkosten
 */

import { formatInTimeZone } from "date-fns-tz";
import { inIsoRange, round2 } from "@/lib/management-dashboard/periods";
import { isOrderVolledigBetaald } from "@/lib/aanbetaling";
import { hardwareKostenVoorRegels } from "@/lib/project-kosten";
import { META_LEAD_CAMPAIGN_ID } from "@/lib/meta-ads-spend";
import { materiaalNogTeBestellen } from "@/lib/inkoop-sla";
import type { Project } from "@/types/database";
import type { DashboardV2Bucket } from "./types";

const TZ = "Europe/Amsterdam";

export type FinancePoint = {
  key: string;
  label: string;
  omzet: number;
  salesKosten: number;
  inkoopkosten: number;
  leadKosten: number;
};

export type DashboardV2Finance = {
  /** Totalen over de geselecteerde periode */
  totals: {
    omzet: number;
    salesKosten: number;
    inkoopkosten: number;
    leadKosten: number;
    /** omzet − sales − inkoop − lead */
    resultaat: number;
  };
  /**
   * Open inkoop-backlog: alle volledig betaalde orders die nog besteld
   * moeten worden (los van periodefilter).
   */
  inkoopTeBestellenTotaal: number;
  inkoopTeBestellenOrders: number;
  /** Per bucket (zelfde keys als dashboard buckets) */
  points: FinancePoint[];
};

export type FinanceRaw = {
  offertes: {
    id: string;
    lead_id: string;
    adviseur_id: string | null;
    ondertekend_op: string | null;
    subtotaal_ex_btw: number;
    totaal_inc_btw?: number | null;
    geannuleerd?: boolean;
    regels?: { omschrijving?: string | null; aantal?: number | null }[];
  }[];
  facturen: {
    id: string;
    offerte_id: string | null;
    lead_id: string;
    status: string;
    bedrag_inc_btw: number | null;
    betaald_op: string | null;
    omschrijving?: string | null;
    credit_van_factuur_id?: string | null;
  }[];
  projecten: {
    id: string;
    offerte_id: string | null;
    status: string | null;
    materiaal_checks?: Record<string, unknown> | null;
  }[];
  kosten: {
    datum: string;
    soort: "ad_spend" | "sales" | string;
    bedrag: number;
  }[];
  metaSpend: {
    datum: string;
    spend: number;
    campaign_id?: string | null;
  }[];
  commissieByAdviseur: Map<string, number>;
};

function dayKey(iso: string): string {
  return formatInTimeZone(new Date(iso), TZ, "yyyy-MM-dd");
}

function emptyPoint(key: string, label: string): FinancePoint {
  return {
    key,
    label,
    omzet: 0,
    salesKosten: 0,
    inkoopkosten: 0,
    leadKosten: 0,
  };
}

function findBucketKey(
  iso: string,
  buckets: { key: string; start: string; end: string }[]
): string | null {
  const t = new Date(iso).getTime();
  for (const b of buckets) {
    const s = new Date(b.start).getTime();
    const e = new Date(b.end).getTime();
    if (t >= s && t <= e) return b.key;
  }
  return null;
}

function lastBetaaldAt(
  facturen: FinanceRaw["facturen"]
): string | null {
  let latest: string | null = null;
  for (const f of facturen) {
    if (f.status !== "betaald" || !f.betaald_op) continue;
    if (!latest || f.betaald_op > latest) latest = f.betaald_op;
  }
  return latest;
}

export function buildDashboardV2Finance(
  raw: FinanceRaw,
  opts: {
    rangeStart: string;
    rangeEnd: string;
    buckets: Pick<DashboardV2Bucket, "key" | "label" | "start" | "end">[];
  }
): DashboardV2Finance {
  const range = {
    start: new Date(opts.rangeStart),
    end: new Date(opts.rangeEnd),
  };

  const byKey = new Map<string, FinancePoint>();
  for (const b of opts.buckets) {
    byKey.set(b.key, emptyPoint(b.key, b.label));
  }

  const facByOfferte = new Map<string, FinanceRaw["facturen"]>();
  for (const f of raw.facturen) {
    if (!f.offerte_id) continue;
    const list = facByOfferte.get(f.offerte_id) || [];
    list.push(f);
    facByOfferte.set(f.offerte_id, list);
  }

  const projectByOfferte = new Map(
    raw.projecten
      .filter((p) => p.offerte_id)
      .map((p) => [p.offerte_id as string, p])
  );

  let omzetT = 0;
  let salesT = 0;
  let inkoopT = 0;
  let leadT = 0;
  let inkoopTeBestellenTotaal = 0;
  let inkoopTeBestellenOrders = 0;

  // ── Omzet + sales commissie + inkoop (betaalde orders) ─────────────
  for (const o of raw.offertes) {
    if (o.geannuleerd) continue;
    const signedAt = o.ondertekend_op;
    if (!signedAt) continue;

    const omzet = Number(o.subtotaal_ex_btw) || 0;
    const facs = facByOfferte.get(o.id) || [];
    const volledigBetaald = isOrderVolledigBetaald({
      facturen: facs,
      orderIncBtw: o.totaal_inc_btw ?? null,
    });
    const inkoop = hardwareKostenVoorRegels(o.regels || []).totaal;
    const project = projectByOfferte.get(o.id);
    const nogTeBestellen = project
      ? materiaalNogTeBestellen({
          status: project.status,
          materiaal_checks: (project.materiaal_checks || {}) as Project["materiaal_checks"],
        } as Project)
      : volledigBetaald;

    // Open backlog (alle orders): volledig betaald + nog te bestellen
    if (volledigBetaald && nogTeBestellen && inkoop > 0) {
      inkoopTeBestellenTotaal = round2(inkoopTeBestellenTotaal + inkoop);
      inkoopTeBestellenOrders += 1;
    }

    // Omzet + commissie op ondertekening in periode
    if (inIsoRange(signedAt, range.start, range.end)) {
      omzetT = round2(omzetT + omzet);
      const pct = o.adviseur_id
        ? raw.commissieByAdviseur.get(o.adviseur_id) ?? 0
        : 0;
      const commissie = pct > 0 ? round2((omzet * pct) / 100) : 0;
      salesT = round2(salesT + commissie);

      const bk = findBucketKey(signedAt, opts.buckets);
      if (bk) {
        const p = byKey.get(bk)!;
        p.omzet = round2(p.omzet + omzet);
        p.salesKosten = round2(p.salesKosten + commissie);
      }
    }

    // Inkoopkosten: betaalde orders die besteld moeten worden
    // Toekenning op laatste betaaldatum (in periode)
    if (volledigBetaald && nogTeBestellen && inkoop > 0) {
      const paidAt = lastBetaaldAt(facs) || signedAt;
      if (inIsoRange(paidAt, range.start, range.end)) {
        inkoopT = round2(inkoopT + inkoop);
        const bk = findBucketKey(paidAt, opts.buckets);
        if (bk) {
          const p = byKey.get(bk)!;
          p.inkoopkosten = round2(p.inkoopkosten + inkoop);
        }
      }
    }
  }

  // ── Handmatige sales-kosten ────────────────────────────────────────
  for (const k of raw.kosten) {
    if (k.soort !== "sales") continue;
    const iso = `${k.datum}T12:00:00`;
    if (!inIsoRange(iso, range.start, range.end)) continue;
    const bedrag = Number(k.bedrag) || 0;
    salesT = round2(salesT + bedrag);
    const bk = findBucketKey(iso, opts.buckets);
    if (bk) {
      const p = byKey.get(bk)!;
      p.salesKosten = round2(p.salesKosten + bedrag);
    }
  }

  // ── Leadkosten: Meta lead-campagne, anders ad_spend uit kosten ─────
  const metaInRange = raw.metaSpend.filter((m) => {
    const iso = `${m.datum}T12:00:00`;
    if (!inIsoRange(iso, range.start, range.end)) return false;
    if (!m.campaign_id) return true;
    return m.campaign_id === META_LEAD_CAMPAIGN_ID;
  });

  if (metaInRange.length > 0) {
    for (const m of metaInRange) {
      const iso = `${m.datum}T12:00:00`;
      const bedrag = Number(m.spend) || 0;
      leadT = round2(leadT + bedrag);
      const bk = findBucketKey(iso, opts.buckets);
      if (bk) {
        const p = byKey.get(bk)!;
        p.leadKosten = round2(p.leadKosten + bedrag);
      }
    }
  } else {
    for (const k of raw.kosten) {
      if (k.soort !== "ad_spend") continue;
      const iso = `${k.datum}T12:00:00`;
      if (!inIsoRange(iso, range.start, range.end)) continue;
      const bedrag = Number(k.bedrag) || 0;
      leadT = round2(leadT + bedrag);
      const bk = findBucketKey(iso, opts.buckets);
      if (bk) {
        const p = byKey.get(bk)!;
        p.leadKosten = round2(p.leadKosten + bedrag);
      }
    }
  }

  return {
    totals: {
      omzet: omzetT,
      salesKosten: salesT,
      // Periode: inkoop toegekend op betaaldatum; fallback = open backlog alle orders
      inkoopkosten: inkoopT > 0 ? inkoopT : inkoopTeBestellenTotaal,
      leadKosten: leadT,
      resultaat: round2(
        omzetT -
          salesT -
          (inkoopT > 0 ? inkoopT : inkoopTeBestellenTotaal) -
          leadT
      ),
    },
    inkoopTeBestellenTotaal,
    inkoopTeBestellenOrders,
    points: opts.buckets.map(
      (b) => byKey.get(b.key) || emptyPoint(b.key, b.label)
    ),
  };
}

export function emptyDashboardV2Finance(): DashboardV2Finance {
  return {
    totals: {
      omzet: 0,
      salesKosten: 0,
      inkoopkosten: 0,
      leadKosten: 0,
      resultaat: 0,
    },
    inkoopTeBestellenTotaal: 0,
    inkoopTeBestellenOrders: 0,
    points: [],
  };
}

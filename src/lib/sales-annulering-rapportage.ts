/**
 * Sales-annuleringen per ISO-week van ondertekening (cohort).
 * Uitval = unieke leads met projectstatus annulering óf HOLD SALES.
 * Meerdere projecten per lead tellen niet dubbel.
 */

import { addWeeks } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ } from "@/lib/format";
import { normalizeProjectStatus } from "@/lib/labels";
import { round2, safeDiv } from "@/lib/management-dashboard/periods";
import {
  formatSchouwWeekLabel,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";

export type SalesAnnuleringWeek = {
  weekKey: string;
  label: string;
  startYmd: string;
  endYmd: string;
  /** Unieke leads met getekende sale in deze week */
  sales: number;
  /** Unieke leads met projectstatus annulering */
  geannuleerd: number;
  /** Unieke leads met HOLD SALES (actie) — apart geteld */
  hold: number;
  /** Unieke leads met annulering of HOLD ÷ sales */
  uitvalPct: number | null;
};

export type SalesAnnuleringRapportage = {
  startYmd: string;
  endYmd: string;
  periodLabel: string;
  totals: {
    sales: number;
    geannuleerd: number;
    hold: number;
    uitvalPct: number | null;
  };
  series: SalesAnnuleringWeek[];
};

export type SaleOfferteRow = {
  id: string;
  lead_id: string | null;
  ondertekend_op: string;
};

export type ProjectUitvalFlag = {
  offerte_id: string | null;
  lead_id: string | null;
  status: string | null;
};

function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function noonAmsterdamFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function defaultSalesAnnuleringRange(now = new Date()): {
  startYmd: string;
  endYmd: string;
} {
  const today = ymdAmsterdam(toZonedTime(now, AMSTERDAM_TZ));
  const endInfo = schouwWeekFromDate(noonAmsterdamFromYmd(today));
  const endMonday = String(
    schouwWeekToMondayIso(endInfo.jaar, endInfo.week)
  ).slice(0, 10);
  const startMonday = ymdAmsterdam(
    addWeeks(noonAmsterdamFromYmd(endMonday), -15)
  );
  return { startYmd: startMonday, endYmd: today };
}

function listWeekWindows(
  startYmd: string,
  endYmd: string
): { weekKey: string; label: string; startYmd: string; endYmd: string }[] {
  const out: {
    weekKey: string;
    label: string;
    startYmd: string;
    endYmd: string;
  }[] = [];
  let cursor = startYmd;
  const endInfo = schouwWeekFromDate(noonAmsterdamFromYmd(endYmd));
  const lastKey = schouwWeekValue(endInfo.jaar, endInfo.week);
  for (let i = 0; i < 80; i++) {
    const info = schouwWeekFromDate(noonAmsterdamFromYmd(cursor));
    const weekKey = schouwWeekValue(info.jaar, info.week);
    const mon = String(schouwWeekToMondayIso(info.jaar, info.week)).slice(
      0,
      10
    );
    const sun = shiftYmd(mon, 6);
    out.push({
      weekKey,
      label: formatSchouwWeekLabel(info.jaar, info.week),
      startYmd: mon,
      endYmd: sun > endYmd ? endYmd : sun,
    });
    if (weekKey === lastKey) break;
    cursor = shiftYmd(mon, 7);
  }
  return out;
}

function inRange(iso: string, startYmd: string, endYmd: string): boolean {
  const ymd = formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "yyyy-MM-dd");
  return ymd >= startYmd && ymd <= endYmd;
}

/** Annulering of HOLD SALES telt als uitval (voor nu). */
export function isSalesUitvalStatus(status: string | null | undefined): boolean {
  const raw = (status || "").trim().toLowerCase();
  // Legacy DB-waarde vóór remap; ProjectStatus kent alleen hold_sales_actie.
  if (raw === "hold_sales") return true;
  const st = normalizeProjectStatus(status || "");
  return st === "annulering" || st === "hold_sales_actie";
}

export function isHoldSalesStatus(status: string | null | undefined): boolean {
  const raw = (status || "").trim().toLowerCase();
  if (raw === "hold_sales") return true;
  return normalizeProjectStatus(status || "") === "hold_sales_actie";
}

export function isAnnuleringStatus(status: string | null | undefined): boolean {
  return normalizeProjectStatus(status || "") === "annulering";
}

export function buildSalesAnnuleringRapportage(opts: {
  startYmd: string;
  endYmd: string;
  sales: SaleOfferteRow[];
  projects: ProjectUitvalFlag[];
}): SalesAnnuleringRapportage {
  const weeks = listWeekWindows(opts.startYmd, opts.endYmd);

  /** offerte_id → flags from any linked project */
  const byOfferte = new Map<
    string,
    { annulering: boolean; hold: boolean; leadId: string | null }
  >();
  for (const p of opts.projects) {
    if (!p.offerte_id) continue;
    const cur = byOfferte.get(p.offerte_id) || {
      annulering: false,
      hold: false,
      leadId: p.lead_id,
    };
    if (isAnnuleringStatus(p.status)) cur.annulering = true;
    if (isHoldSalesStatus(p.status)) cur.hold = true;
    if (!cur.leadId && p.lead_id) cur.leadId = p.lead_id;
    byOfferte.set(p.offerte_id, cur);
  }

  type WeekAcc = {
    saleLeads: Set<string>;
    annulLeads: Set<string>;
    holdLeads: Set<string>;
    uitvalLeads: Set<string>;
  };
  const byWeek = new Map<string, WeekAcc>();
  for (const w of weeks) {
    byWeek.set(w.weekKey, {
      saleLeads: new Set(),
      annulLeads: new Set(),
      holdLeads: new Set(),
      uitvalLeads: new Set(),
    });
  }

  for (const s of opts.sales) {
    if (!s.ondertekend_op) continue;
    if (!inRange(s.ondertekend_op, opts.startYmd, opts.endYmd)) continue;
    const leadKey = (s.lead_id || `offerte:${s.id}`).trim();
    if (!leadKey) continue;

    const info = schouwWeekFromDate(new Date(s.ondertekend_op));
    const key = schouwWeekValue(info.jaar, info.week);
    const bucket = byWeek.get(key);
    if (!bucket) continue;

    bucket.saleLeads.add(leadKey);

    const flags = byOfferte.get(s.id);
    if (!flags) continue;
    if (flags.annulering) {
      bucket.annulLeads.add(leadKey);
      bucket.uitvalLeads.add(leadKey);
    }
    if (flags.hold) {
      bucket.holdLeads.add(leadKey);
      bucket.uitvalLeads.add(leadKey);
    }
  }

  const series: SalesAnnuleringWeek[] = weeks.map((w) => {
    const b = byWeek.get(w.weekKey)!;
    const sales = b.saleLeads.size;
    const geannuleerd = b.annulLeads.size;
    const hold = b.holdLeads.size;
    const uitval = b.uitvalLeads.size;
    const pct = safeDiv(uitval, sales);
    return {
      ...w,
      sales,
      geannuleerd,
      hold,
      uitvalPct: pct != null ? round2(pct * 100) : null,
    };
  });

  // Onderteken-weken partitioneren leads → weekly counts mogen sommeren
  const totalsSales = series.reduce((s, w) => s + w.sales, 0);
  const totalsGeann = series.reduce((s, w) => s + w.geannuleerd, 0);
  const totalsHold = series.reduce((s, w) => s + w.hold, 0);
  const totUitval = weeks.reduce(
    (s, w) => s + (byWeek.get(w.weekKey)?.uitvalLeads.size || 0),
    0
  );
  const totPct = safeDiv(totUitval, totalsSales);

  const startLabel = formatInTimeZone(
    noonAmsterdamFromYmd(opts.startYmd),
    AMSTERDAM_TZ,
    "d MMM",
    { locale: nl }
  );
  const endLabel = formatInTimeZone(
    noonAmsterdamFromYmd(opts.endYmd),
    AMSTERDAM_TZ,
    "d MMM yyyy",
    { locale: nl }
  );

  return {
    startYmd: opts.startYmd,
    endYmd: opts.endYmd,
    periodLabel: `${startLabel} – ${endLabel}`,
    totals: {
      sales: totalsSales,
      geannuleerd: totalsGeann,
      hold: totalsHold,
      uitvalPct: totPct != null ? round2(totPct * 100) : null,
    },
    series,
  };
}

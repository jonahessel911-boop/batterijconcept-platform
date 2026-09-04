import {
  addDays,
  endOfISOWeek,
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
  subWeeks,
} from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { isAanbetalingFactuurOmschrijving } from "@/lib/aanbetaling";
import { AMSTERDAM_TZ } from "@/lib/format";

/** Vast bedrag dat de verkoper (ZZP) factureert per betaalde klant-aanbetaling. */
export const VERKOPER_AANBETALING_FEE = 250;

export type CreditWeek = {
  jaar: number;
  week: number;
  van: string;
  tot: string;
  /** Maandag waarop deze week wordt uitbetaald (= maandag na de week). */
  betaalMaandag: string;
};

function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

/** ISO-week (ma–zo) in Amsterdam, plus de maandag erna als betaaldag. */
export function creditWeekFromDate(anchor: Date = new Date()): CreditWeek {
  const local = toZonedTime(anchor, AMSTERDAM_TZ);
  const monday = startOfISOWeek(local);
  const sunday = endOfISOWeek(local);
  const payMonday = addDays(sunday, 1);
  return {
    jaar: getISOWeekYear(monday),
    week: getISOWeek(monday),
    van: ymdAmsterdam(monday),
    tot: ymdAmsterdam(sunday),
    betaalMaandag: ymdAmsterdam(payMonday),
  };
}

/** Vorige volledige ISO-week (typisch: op maandag de afgelopen ma–zo uitbetalen). */
export function previousCreditWeek(now: Date = new Date()): CreditWeek {
  return creditWeekFromDate(subWeeks(toZonedTime(now, AMSTERDAM_TZ), 1));
}

export function creditWeekByYearWeek(jaar: number, week: number): CreditWeek {
  // Donderdag in die ISO-week is altijd in het juiste jaar
  const jan4 = toZonedTime(new Date(Date.UTC(jaar, 0, 4)), AMSTERDAM_TZ);
  const week1Monday = startOfISOWeek(jan4);
  const monday = addDays(week1Monday, (week - 1) * 7);
  const sunday = endOfISOWeek(monday);
  return {
    jaar: getISOWeekYear(monday),
    week: getISOWeek(monday),
    van: ymdAmsterdam(monday),
    tot: ymdAmsterdam(sunday),
    betaalMaandag: ymdAmsterdam(addDays(sunday, 1)),
  };
}

export type EligibleAanbetaling = {
  factuur_id: string;
  factuur_nummer: string;
  lead_id: string;
  lead_naam: string | null;
  offerte_nummer: string | null;
  betaald_op: string;
  fee: number;
};

export function filterEligibleAanbetalingen(rows: {
  id: string;
  factuur_nummer: string;
  lead_id: string;
  status: string;
  omschrijving: string | null;
  betaald_op: string | null;
  lead_naam?: string | null;
  offerte_nummer?: string | null;
  already_invoiced?: boolean;
}[]): EligibleAanbetaling[] {
  const out: EligibleAanbetaling[] = [];
  for (const r of rows) {
    if (r.status !== "betaald") continue;
    if (!r.betaald_op) continue;
    if (!isAanbetalingFactuurOmschrijving(r.omschrijving)) continue;
    if (r.already_invoiced) continue;
    out.push({
      factuur_id: r.id,
      factuur_nummer: r.factuur_nummer,
      lead_id: r.lead_id,
      lead_naam: r.lead_naam || null,
      offerte_nummer: r.offerte_nummer || null,
      betaald_op: r.betaald_op.slice(0, 10),
      fee: VERKOPER_AANBETALING_FEE,
    });
  }
  return out;
}

export function computeCreditInvoiceAmount(opts: {
  aantal: number;
  fee?: number;
  maxBedrag?: number | null;
}): {
  bruto: number;
  bedrag: number;
  capped: boolean;
  maxToegepast: number | null;
} {
  const fee = opts.fee ?? VERKOPER_AANBETALING_FEE;
  const bruto = Math.round(opts.aantal * fee * 100) / 100;
  const max =
    opts.maxBedrag != null && Number(opts.maxBedrag) > 0
      ? Number(opts.maxBedrag)
      : null;
  if (max != null && bruto > max) {
    return {
      bruto,
      bedrag: Math.round(max * 100) / 100,
      capped: true,
      maxToegepast: max,
    };
  }
  return { bruto, bedrag: bruto, capped: false, maxToegepast: null };
}

export function formatCreditFactuurNummer(
  jaar: number,
  week: number,
  seq: number
): string {
  return `CF-${jaar}-W${String(week).padStart(2, "0")}-${String(seq).padStart(3, "0")}`;
}

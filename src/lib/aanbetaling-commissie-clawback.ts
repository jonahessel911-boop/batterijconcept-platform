/**
 * Verkoper-voorschot terugboeken als de klant-aanbetaling later
 * is gecrediteerd én terugbetaald, terwijl de commissie al is uitbetaald.
 * Komt als negatieve regel op de eerstvolgende open sales-weekfactuur.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import { isAanbetalingFactuurOmschrijving } from "@/lib/aanbetaling";
import {
  creditWeekFromDate,
  previousCreditWeek,
  type CreditWeek,
} from "@/lib/adviseur-creditfactuur";
import {
  findOrCreateWeekSalesCreditfactuur,
  recalcAdviseurCreditfactuurFromRegels,
} from "@/lib/netto-creditfactuur";

export const CLAWBACK_TAG = "clawback_aanbetaling:";

export type AanbetalingClawbackPending = {
  parentFactuurId: string;
  parentFactuurNummer: string;
  creditFactuurId: string;
  creditFactuurNummer: string | null;
  leadId: string | null;
  klantNaam: string | null;
  adviseurId: string;
  adviseurNaam: string | null;
  bedragEx: number;
  oorspronkelijkeCfNummer: string | null;
};

function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function clawbackTag(parentFactuurId: string): string {
  return `${CLAWBACK_TAG}${parentFactuurId}`;
}

/** Zelfde week als de eerstvolgende verkopers-woensdagronde. */
export function eerstvolgendeSalesUitbetalingsweek(
  now = new Date()
): CreditWeek {
  const prev = previousCreditWeek(now);
  const today = ymdAmsterdam(now);
  if (today <= prev.betaalWoensdag) return prev;
  return creditWeekFromDate(now);
}

function volgendeWeek(week: CreditWeek): CreditWeek {
  const tot = toZonedTime(new Date(`${week.tot}T12:00:00`), AMSTERDAM_TZ);
  return creditWeekFromDate(addDays(tot, 2));
}

export async function listPendingAanbetalingClawbacks(
  sb: SupabaseClient
): Promise<AanbetalingClawbackPending[]> {
  const { data: credits, error: cErr } = await sb
    .from("facturen")
    .select(
      "id, factuur_nummer, credit_van_factuur_id, status, betaald_op"
    )
    .not("credit_van_factuur_id", "is", null)
    .eq("status", "betaald")
    .not("betaald_op", "is", null)
    .limit(2000);
  if (cErr) throw cErr;
  const creditRows = credits || [];
  if (creditRows.length === 0) return [];

  const parentIds = [
    ...new Set(
      creditRows
        .map((c) => c.credit_van_factuur_id as string)
        .filter(Boolean)
    ),
  ];
  const { data: parents, error: pErr } = await sb
    .from("facturen")
    .select(
      "id, factuur_nummer, lead_id, omschrijving, status, betaald_op"
    )
    .in("id", parentIds);
  if (pErr) throw pErr;

  const aanbetalingParents = (parents || []).filter(
    (p) =>
      isAanbetalingFactuurOmschrijving(p.omschrijving) &&
      p.status === "betaald" &&
      p.betaald_op
  );
  if (aanbetalingParents.length === 0) return [];

  const aanbetalingIds = aanbetalingParents.map((p) => p.id as string);
  const creditIds = creditRows.map((c) => c.id as string);

  const { data: payoutRegels } = await sb
    .from("adviseur_creditfactuur_regels")
    .select(
      "id, factuur_id, lead_id, bedrag, omschrijving, creditfactuur_id, adviseur_creditfacturen(id, status, factuur_nummer, adviseur_id)"
    )
    .in("factuur_id", [...aanbetalingIds, ...creditIds]);

  const paidByParent = new Map<
    string,
    {
      bedrag: number;
      adviseurId: string;
      cfNummer: string | null;
    }
  >();
  const clawedParentIds = new Set<string>();
  const usedFactuurIds = new Set<string>();

  for (const r of payoutRegels || []) {
    usedFactuurIds.add(r.factuur_id as string);
    const oms = String(r.omschrijving || "");
    const tagIdx = oms.indexOf(CLAWBACK_TAG);
    if (tagIdx >= 0) {
      const rest = oms.slice(tagIdx + CLAWBACK_TAG.length);
      const id = rest.split(/\s/)[0]?.trim();
      if (id) clawedParentIds.add(id);
    }
    if (Number(r.bedrag) < 0) {
      const credit = creditRows.find((c) => c.id === r.factuur_id);
      if (credit?.credit_van_factuur_id) {
        clawedParentIds.add(credit.credit_van_factuur_id as string);
      }
    }
    const cfRaw = (r as { adviseur_creditfacturen?: unknown })
      .adviseur_creditfacturen;
    const cf = Array.isArray(cfRaw) ? cfRaw[0] : cfRaw;
    const cfRow = cf as {
      status?: string;
      factuur_nummer?: string;
      adviseur_id?: string;
    } | null;
    if (!cfRow || cfRow.status === "geannuleerd") continue;
    if (cfRow.status !== "betaald" && cfRow.status !== "goedgekeurd") {
      continue;
    }
    if (!(Number(r.bedrag) > 0)) continue;
    if (!aanbetalingIds.includes(r.factuur_id as string)) continue;
    if (!cfRow.adviseur_id) continue;
    paidByParent.set(r.factuur_id as string, {
      bedrag: Math.round(Number(r.bedrag) * 100) / 100,
      adviseurId: cfRow.adviseur_id,
      cfNummer: cfRow.factuur_nummer || null,
    });
  }

  const creditsByParent = new Map<
    string,
    { id: string; factuur_nummer: string | null }[]
  >();
  for (const c of creditRows) {
    const pid = c.credit_van_factuur_id as string;
    const list = creditsByParent.get(pid) || [];
    list.push({
      id: c.id as string,
      factuur_nummer: (c.factuur_nummer as string | null) || null,
    });
    creditsByParent.set(pid, list);
  }

  const leadIds = [
    ...new Set(
      aanbetalingParents
        .map((p) => p.lead_id as string | null)
        .filter((x): x is string => Boolean(x))
    ),
  ];
  const { data: leads } = leadIds.length
    ? await sb.from("leads").select("id, naam").in("id", leadIds)
    : { data: [] as { id: string; naam: string | null }[] };
  const leadById = new Map((leads || []).map((l) => [l.id, l]));

  const advIds = [
    ...new Set(
      [...paidByParent.values()].map((p) => p.adviseurId).filter(Boolean)
    ),
  ];
  const { data: adviseurs } = advIds.length
    ? await sb.from("adviseurs").select("id, naam").in("id", advIds)
    : { data: [] as { id: string; naam: string | null }[] };
  const advById = new Map((adviseurs || []).map((a) => [a.id, a]));

  const out: AanbetalingClawbackPending[] = [];
  for (const parent of aanbetalingParents) {
    const paid = paidByParent.get(parent.id as string);
    if (!paid) continue;
    if (clawedParentIds.has(parent.id as string)) continue;
    const credits = creditsByParent.get(parent.id as string) || [];
    const credit =
      credits.find((c) => !usedFactuurIds.has(c.id)) || credits[0];
    if (!credit) continue;
    const lead = parent.lead_id
      ? leadById.get(parent.lead_id as string)
      : null;
    const adv = advById.get(paid.adviseurId);
    out.push({
      parentFactuurId: parent.id as string,
      parentFactuurNummer: (parent.factuur_nummer as string) || "—",
      creditFactuurId: credit.id,
      creditFactuurNummer: credit.factuur_nummer,
      leadId: (parent.lead_id as string | null) || null,
      klantNaam: lead?.naam || null,
      adviseurId: paid.adviseurId,
      adviseurNaam: adv?.naam || null,
      bedragEx: paid.bedrag,
      oorspronkelijkeCfNummer: paid.cfNummer,
    });
  }
  return out;
}

async function openSalesWeekCf(
  sb: SupabaseClient,
  adviseurId: string,
  now: Date
): Promise<{ id: string; week: CreditWeek } | null> {
  let week = eerstvolgendeSalesUitbetalingsweek(now);
  for (let i = 0; i < 6; i++) {
    const cf = await findOrCreateWeekSalesCreditfactuur(sb, {
      adviseurId,
      week,
    });
    if (!cf.id) return null;
    if (cf.status === "concept") {
      return { id: cf.id, week };
    }
    week = volgendeWeek(week);
  }
  return null;
}

export async function ensureAanbetalingCommissieClawbacks(
  sb: SupabaseClient,
  now = new Date()
): Promise<{ applied: number; errors: string[] }> {
  const pending = await listPendingAanbetalingClawbacks(sb);
  const errors: string[] = [];
  let applied = 0;
  const touched = new Set<string>();

  for (const row of pending) {
    const target = await openSalesWeekCf(sb, row.adviseurId, now);
    if (!target) {
      errors.push(
        `${row.parentFactuurNummer}: geen open weekfactuur voor clawback`
      );
      continue;
    }
    const { error } = await sb.from("adviseur_creditfactuur_regels").insert({
      creditfactuur_id: target.id,
      factuur_id: row.creditFactuurId,
      lead_id: row.leadId,
      bedrag: -Math.abs(row.bedragEx),
      omschrijving: [
        `Terugboeking voorschot −€${Math.abs(row.bedragEx).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        row.klantNaam,
        `was ${row.parentFactuurNummer}`,
        row.creditFactuurNummer ? `credit ${row.creditFactuurNummer}` : null,
        row.oorspronkelijkeCfNummer
          ? `uit ${row.oorspronkelijkeCfNummer}`
          : null,
        clawbackTag(row.parentFactuurId),
      ]
        .filter(Boolean)
        .join(" · "),
    });
    if (error) {
      if (error.code === "23505") continue;
      errors.push(
        `${row.parentFactuurNummer}: ${error.message || "clawback mislukt"}`
      );
      continue;
    }
    applied += 1;
    touched.add(target.id);
  }

  for (const cfId of touched) {
    await recalcAdviseurCreditfactuurFromRegels(sb, cfId);
  }

  return { applied, errors };
}

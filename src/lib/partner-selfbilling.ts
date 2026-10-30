/**
 * Selfbilling voor montagepartners: vrije factuurregels + 21% BTW.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { creditWeekFromDate } from "@/lib/adviseur-creditfactuur";
import {
  encodePartnerFactuurRegels,
  formatPartnerCreditFactuurNummer,
} from "@/lib/pdf-partner-creditfactuur";
import {
  RELATIE_FACTUUR_BETAALTERMIJN_DAGEN,
  bedragenMetBtw,
  type RelatieFactuurRegel,
} from "@/lib/pdf-relatie-factuur";
import { dayKeyAmsterdam } from "@/lib/planning-window";

export type PartnerSelfbillingRegelInput = {
  omschrijving?: string | null;
  bedrag_ex_btw?: number | string | null;
  bedrag?: number | string | null;
  project_nummer?: string | null;
  offerte_nummer?: string | null;
};

export function normalizePartnerSelfbillingRegels(
  raw: PartnerSelfbillingRegelInput[] | null | undefined
): RelatieFactuurRegel[] {
  if (!Array.isArray(raw)) return [];
  const out: RelatieFactuurRegel[] = [];
  for (const r of raw) {
    const omschrijving = String(r.omschrijving || "").trim();
    const bedragRaw =
      r.bedrag_ex_btw != null && r.bedrag_ex_btw !== ""
        ? Number(r.bedrag_ex_btw)
        : Number(r.bedrag);
    if (!omschrijving) continue;
    if (!Number.isFinite(bedragRaw) || bedragRaw <= 0) continue;
    out.push({
      omschrijving,
      bedrag: Math.round(bedragRaw * 100) / 100,
      project_nummer: r.project_nummer?.trim() || null,
      offerte_nummer: r.offerte_nummer?.trim() || null,
    });
  }
  return out;
}

export type CreatePartnerSelfbillingResult =
  | { ok: true; factuur: Record<string, unknown> }
  | { ok: false; error: string; status: number };

/**
 * Maakt een partner_creditfactuur (concept) met vrije regels + 21% BTW.
 * Regels landen in notities als REGELS_JSON voor de PDF.
 */
export async function createPartnerSelfbillingFactuur(
  sb: SupabaseClient,
  opts: {
    partnerId: string;
    regels: RelatieFactuurRegel[];
    omschrijving?: string | null;
    notities?: string | null;
    project_nummer?: string | null;
    offerte_nummer?: string | null;
    /** concept (default) | goedgekeurd (partner dient zelf in) */
    status?: "concept" | "goedgekeurd";
    mark_paid?: boolean;
  }
): Promise<CreatePartnerSelfbillingResult> {
  const regels = opts.regels.filter((r) => r.bedrag > 0 && r.omschrijving.trim());
  if (regels.length === 0) {
    return {
      ok: false,
      error: "Voeg minstens één regel toe (omschrijving + bedrag excl. btw)",
      status: 400,
    };
  }

  const { data: partner, error: pErr } = await sb
    .from("installatie_partners")
    .select(
      "id, naam, email, bedrijfsnaam, kvk_nummer, btw_nummer, iban, factuur_adres, factuur_postcode, factuur_plaats"
    )
    .eq("id", opts.partnerId)
    .maybeSingle();

  if (pErr || !partner) {
    return { ok: false, error: "Partner niet gevonden", status: 404 };
  }
  if (!partner.bedrijfsnaam || !partner.kvk_nummer || !partner.iban) {
    return {
      ok: false,
      error:
        "Vul eerst KvK-gegevens in: bedrijfsnaam, KvK en IBAN (Instellingen / Team).",
      status: 400,
    };
  }
  if (!partner.email?.trim()) {
    return {
      ok: false,
      error: "Vul eerst een e-mailadres in bij de installatiepartner.",
      status: 400,
    };
  }

  const bedragEx = Math.round(
    regels.reduce((s, r) => s + r.bedrag, 0) * 100
  ) / 100;
  if (bedragEx <= 0) {
    return {
      ok: false,
      error: "Totaalbedrag excl. btw moet groter dan 0 zijn",
      status: 400,
    };
  }

  const withBtw = bedragenMetBtw(bedragEx);
  const weekInfo = creditWeekFromDate(new Date());
  const jaar = weekInfo.jaar;
  const { count } = await sb
    .from("partner_creditfacturen")
    .select("id", { count: "exact", head: true })
    .gte("factuurdatum", `${jaar}-01-01`)
    .lte("factuurdatum", `${jaar}-12-31`);

  const factuurNummer = formatPartnerCreditFactuurNummer(
    jaar,
    (count || 0) + 1
  );

  const project_nummer =
    opts.project_nummer?.trim() ||
    regels.find((r) => r.project_nummer)?.project_nummer ||
    null;
  const offerte_nummer =
    opts.offerte_nummer?.trim() ||
    regels.find((r) => r.offerte_nummer)?.offerte_nummer ||
    null;

  const omschrijving =
    opts.omschrijving?.trim() ||
    (regels.length === 1
      ? regels[0]!.omschrijving
      : `Extra werkzaamheden (${regels.length} regels)`);

  const status = opts.mark_paid
    ? "betaald"
    : opts.status === "goedgekeurd"
      ? "goedgekeurd"
      : "concept";
  const today = dayKeyAmsterdam(new Date());
  const nowIso = new Date().toISOString();

  const humanNotes = [
    opts.notities?.trim() || null,
    `Selfbilling ${partner.bedrijfsnaam} → Batterijconcept.`,
    `BTW 21% · betaaltermijn ${RELATIE_FACTUUR_BETAALTERMIJN_DAGEN} dagen.`,
    `KvK ${partner.kvk_nummer}, IBAN ${partner.iban}.`,
  ]
    .filter(Boolean)
    .join(" ");

  const notities = encodePartnerFactuurRegels(regels, humanNotes);

  const { data: created, error: insErr } = await sb
    .from("partner_creditfacturen")
    .insert({
      partner_id: opts.partnerId,
      factuur_nummer: factuurNummer,
      status,
      week_jaar: weekInfo.jaar,
      week_nummer: weekInfo.week,
      periode_van: weekInfo.van,
      periode_tot: weekInfo.tot,
      omschrijving,
      offerte_nummer,
      project_nummer,
      bedrag_ex_btw: withBtw.bedrag_ex_btw,
      btw_bedrag: withBtw.btw_bedrag,
      bedrag_inc_btw: withBtw.bedrag_inc_btw,
      factuurdatum: today,
      betaald_op: opts.mark_paid ? today : null,
      verzonden_op: status === "goedgekeurd" ? nowIso : null,
      goedgekeurd_op: status === "goedgekeurd" ? nowIso : null,
      notities,
    })
    .select("*")
    .single();

  if (insErr || !created) {
    if (
      insErr?.code === "42703" ||
      insErr?.message?.includes("partner_creditfacturen")
    ) {
      return {
        ok: false,
        error:
          "Voer supabase/migrate-partner-creditfacturen.sql uit in Supabase",
        status: 503,
      };
    }
    return {
      ok: false,
      error: insErr?.message || "Aanmaken mislukt",
      status: 500,
    };
  }

  return { ok: true, factuur: created as Record<string, unknown> };
}

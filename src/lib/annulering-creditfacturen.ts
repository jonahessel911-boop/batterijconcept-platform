import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { splitIncToExBtw } from "@/lib/aanbetaling";
import {
  factuurOmschrijvingMetProduct,
  primaireProductOmschrijving,
} from "@/lib/factuur-omschrijving";
import {
  FACTUUR_BETAALTERMIJN_DAGEN,
  amsterdamDatePlusDays,
} from "@/lib/factuur-betaling";
import { verstuurFactuurNaarKlant } from "@/lib/factuur-versturen";
import { logLeadEvent } from "@/lib/lead-events";

/** Verstuurd naar de klant: betaald, deels betaald of nog open. Concept telt niet. */
const TE_CREDITEREN = ["betaald", "deels_betaald", "verzonden"] as const;

type TeCrediterenFactuur = {
  id: string;
  factuur_nummer: string;
  bedrag_inc_btw: number;
  bedrag_ex_btw: number;
  btw_bedrag: number;
  status: string;
  project_id: string | null;
  lead_id: string;
  offerte_id: string | null;
  omschrijving: string | null;
};

export type AnnuleringCreditResult = {
  origineel: string;
  credit: string | null;
  ok: boolean;
  alVerwerkt: boolean;
  error?: string;
  warning?: string;
};

const VERWERKT = new Set(["betaald", "verzonden", "deels_betaald"]);

async function bestaandCredit(
  sb: SupabaseClient,
  origineelId: string
): Promise<{ id: string; factuur_nummer: string; status: string } | null> {
  const { data } = await sb
    .from("facturen")
    .select("id, factuur_nummer, status, created_at")
    .eq("credit_van_factuur_id", origineelId)
    .order("created_at", { ascending: false });
  const rows = data || [];
  const verwerkt = rows.find((r) => VERWERKT.has(r.status));
  return verwerkt || rows[0] || null;
}

async function boekCreditZonderMail(
  sb: SupabaseClient,
  creditId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const today = amsterdamDatePlusDays(new Date(), 0);
  const { error } = await sb
    .from("facturen")
    .update({
      status: "betaald",
      betaald_op: today,
      factuurdatum: today,
      vervaldatum: null,
    })
    .eq("id", creditId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function maakConceptCredit(
  sb: SupabaseClient,
  orig: TeCrediterenFactuur,
  projectId: string,
  projectNummer: string | null
): Promise<{ id: string; factuur_nummer: string } | { error: string }> {
  let productLabel: string | null = null;
  if (orig.offerte_id) {
    const { data: regels } = await sb
      .from("offerte_regels")
      .select("omschrijving, product_id, prijs_ex_btw, sort_order")
      .eq("offerte_id", orig.offerte_id)
      .order("sort_order", { ascending: true });
    productLabel = primaireProductOmschrijving(regels || []);
  }

  const omschrijving = factuurOmschrijvingMetProduct(
    productLabel,
    `Creditfactuur bij ${orig.factuur_nummer}`
  );

  const origEx = Number(orig.bedrag_ex_btw);
  const origBtw = Number(orig.btw_bedrag);
  const origInc = Number(orig.bedrag_inc_btw);
  const amountsMatch =
    Number.isFinite(origEx) &&
    Number.isFinite(origBtw) &&
    Number.isFinite(origInc) &&
    Math.abs(origEx + origBtw - origInc) < 0.02;
  const split = amountsMatch
    ? { ex: origEx, btw: origBtw, inc: origInc }
    : splitIncToExBtw(origInc);

  const today = new Date();
  const { data: nummer, error: numErr } = await sb.rpc("generate_factuur_nummer");
  if (numErr || !nummer) {
    return { error: numErr?.message || "Kon geen factuurnummer genereren" };
  }

  const notities = projectNummer
    ? `CREDIT FACTUUR (${orig.factuur_nummer}). Betreft ${projectNummer}. Annulering binnen bedenktijd. Er hoeft niets te worden betaald.`
    : `CREDIT FACTUUR (${orig.factuur_nummer}). Annulering binnen bedenktijd. Er hoeft niets te worden betaald.`;

  const { data: factuur, error: insertErr } = await sb
    .from("facturen")
    .insert({
      lead_id: orig.lead_id,
      project_id: orig.project_id || projectId,
      offerte_id: orig.offerte_id || null,
      factuur_nummer: nummer as string,
      status: "concept",
      omschrijving,
      bedrag_ex_btw: split.ex,
      btw_bedrag: split.btw,
      bedrag_inc_btw: split.inc,
      factuurdatum: amsterdamDatePlusDays(today, 0),
      vervaldatum: amsterdamDatePlusDays(today, FACTUUR_BETAALTERMIJN_DAGEN),
      notities,
      credit_van_factuur_id: orig.id,
    })
    .select("id, factuur_nummer")
    .single();

  if (insertErr || !factuur) {
    return { error: insertErr?.message || "Creditfactuur aanmaken mislukt" };
  }
  return factuur;
}

/**
 * Per verstuurde klantfactuur van dit project (betaald, deels betaald of
 * verzonden): eigen creditfactuur, mailen en direct als betaald boeken.
 * Conceptfacturen blijven staan.
 */
export async function creditFacturenBijAnnulering(
  projectId: string
): Promise<{ results: AnnuleringCreditResult[]; error?: string }> {
  const sb = getSupabaseAdmin();
  const { data: project, error: pErr } = await sb
    .from("projecten")
    .select("id, lead_id, offerte_id, project_nummer, status")
    .eq("id", projectId)
    .maybeSingle();
  if (pErr) return { results: [], error: pErr.message };
  if (!project) return { results: [], error: "Project niet gevonden" };

  const filters = [`project_id.eq.${project.id}`];
  if (project.offerte_id) filters.push(`offerte_id.eq.${project.offerte_id}`);

  const { data: rows, error: fErr } = await sb
    .from("facturen")
    .select(
      "id, factuur_nummer, bedrag_inc_btw, bedrag_ex_btw, btw_bedrag, status, project_id, lead_id, offerte_id, omschrijving, credit_van_factuur_id"
    )
    .or(filters.join(","))
    .in("status", [...TE_CREDITEREN])
    .is("credit_van_factuur_id", null);

  if (fErr) return { results: [], error: fErr.message };

  const teCrediteren = (rows || []) as TeCrediterenFactuur[];
  const results: AnnuleringCreditResult[] = [];

  for (const orig of teCrediteren) {
    const bestaand = await bestaandCredit(sb, orig.id);
    if (bestaand && VERWERKT.has(bestaand.status)) {
      results.push({
        origineel: orig.factuur_nummer,
        credit: bestaand.factuur_nummer,
        ok: true,
        alVerwerkt: true,
      });
      continue;
    }

    let creditId = bestaand?.id || null;
    let creditNummer = bestaand?.factuur_nummer || null;
    if (!creditId) {
      const gemaakt = await maakConceptCredit(
        sb,
        orig,
        project.id,
        project.project_nummer || null
      );
      if ("error" in gemaakt) {
        results.push({
          origineel: orig.factuur_nummer,
          credit: null,
          ok: false,
          alVerwerkt: false,
          error: gemaakt.error,
        });
        continue;
      }
      creditId = gemaakt.id;
      creditNummer = gemaakt.factuur_nummer;
    }

    const sent = await verstuurFactuurNaarKlant(creditId);
    if (!sent.ok && sent.error.includes("geen e-mail")) {
      const geboekt = await boekCreditZonderMail(sb, creditId);
      results.push({
        origineel: orig.factuur_nummer,
        credit: creditNummer,
        ok: geboekt.ok,
        alVerwerkt: false,
        error: geboekt.ok ? undefined : geboekt.error,
        warning: geboekt.ok
          ? `${creditNummer || orig.factuur_nummer} geboekt, maar de klant heeft geen e-mailadres`
          : undefined,
      });
      continue;
    }
    results.push({
      origineel: orig.factuur_nummer,
      credit: creditNummer,
      ok: sent.ok,
      alVerwerkt: false,
      error: sent.ok ? undefined : sent.error,
    });
  }

  if (project.lead_id && results.length) {
    const ok = results.filter((r) => r.ok && !r.alVerwerkt);
    if (ok.length) {
      await logLeadEvent({
        leadId: project.lead_id,
        soort: "factuur",
        titel: "Creditfacturen bij annulering binnen bedenktijd",
        detail: ok
          .map((r) => `${r.credit} voor ${r.origineel}`)
          .join(" · "),
        meta: {
          project_id: project.id,
          binnen_bedenktijd: true,
          credits: ok.map((r) => r.credit),
        },
      });
    }
  }

  if (project.status === "annulering") {
    const { syncAutoTakenVoorProject } = await import("@/lib/sync-auto-taken");
    await syncAutoTakenVoorProject(sb, project.id, "annulering");
  }

  return { results };
}

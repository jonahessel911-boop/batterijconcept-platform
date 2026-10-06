import type { SupabaseClient } from "@supabase/supabase-js";
import { creditWeekFromDate } from "@/lib/adviseur-creditfactuur";
import { formatPartnerCreditFactuurNummer } from "@/lib/pdf-partner-creditfactuur";
import {
  RELATIE_FACTUUR_BETAALTERMIJN_DAGEN,
  bedragenMetBtw,
} from "@/lib/pdf-relatie-factuur";
import { STANDAARD_INSTALLATIEKOSTEN } from "@/lib/project-kosten";

/**
 * Maak (of hergebruik) een partner-creditfactuur-concept zodra de installatie
 * is voltooid (opleveringsrapport / status installatie_voltooid).
 * Bedrag = projectkosten of standaard installatiekosten.
 */
export async function ensurePartnerInstallatieCreditfactuur(
  sb: SupabaseClient,
  projectId: string
): Promise<{
  ok: boolean;
  created?: boolean;
  creditfactuur_id?: string;
  skipped?: string;
  error?: string;
}> {
  const { data: project, error: pErr } = await sb
    .from("projecten")
    .select(
      "id, status, project_nummer, installatie_partner_id, projectkosten, offerte_id, offertes(offerte_nummer)"
    )
    .eq("id", projectId)
    .maybeSingle();

  if (pErr || !project) {
    return { ok: false, error: pErr?.message || "Project niet gevonden" };
  }
  if (project.status !== "installatie_voltooid") {
    return { ok: true, skipped: "niet_voltooid" };
  }
  if (!project.installatie_partner_id) {
    return { ok: true, skipped: "geen_partner" };
  }
  if (!project.project_nummer) {
    return { ok: true, skipped: "geen_project_nummer" };
  }

  const { data: existing } = await sb
    .from("partner_creditfacturen")
    .select("id, status")
    .eq("partner_id", project.installatie_partner_id)
    .eq("project_nummer", project.project_nummer)
    .neq("status", "geannuleerd")
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return {
      ok: true,
      created: false,
      creditfactuur_id: existing.id as string,
      skipped: "al_gekoppeld",
    };
  }

  const { data: partner } = await sb
    .from("installatie_partners")
    .select(
      "id, naam, email, bedrijfsnaam, kvk_nummer, iban, actief"
    )
    .eq("id", project.installatie_partner_id)
    .maybeSingle();

  if (!partner || partner.actief === false) {
    return { ok: true, skipped: "partner_ontbreekt" };
  }
  if (!partner.bedrijfsnaam || !partner.kvk_nummer || !partner.iban) {
    return { ok: true, skipped: "kvk_incompleet" };
  }

  const pk = Number(project.projectkosten);
  const bedragEx =
    Number.isFinite(pk) && pk > 0
      ? Math.round(pk * 100) / 100
      : STANDAARD_INSTALLATIEKOSTEN;
  const amounts = bedragenMetBtw(bedragEx);

  const off = project.offertes as
    | { offerte_nummer?: string }
    | { offerte_nummer?: string }[]
    | null;
  const offerte_nummer = Array.isArray(off)
    ? off[0]?.offerte_nummer || null
    : off?.offerte_nummer || null;

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

  const { data: created, error: insErr } = await sb
    .from("partner_creditfacturen")
    .insert({
      partner_id: partner.id,
      factuur_nummer: factuurNummer,
      status: "concept",
      week_jaar: weekInfo.jaar,
      week_nummer: weekInfo.week,
      periode_van: weekInfo.van,
      periode_tot: weekInfo.tot,
      omschrijving: `Installatie ${project.project_nummer}${
        offerte_nummer ? ` · Offerte ${offerte_nummer}` : ""
      }`,
      offerte_nummer,
      project_nummer: project.project_nummer,
      bedrag_ex_btw: amounts.bedrag_ex_btw,
      btw_bedrag: amounts.btw_bedrag,
      bedrag_inc_btw: amounts.bedrag_inc_btw,
      factuurdatum: weekInfo.betaalMaandag,
      notities: [
        `Concept na installatie voltooid · project ${project.project_nummer}.`,
        `Factuur van ${partner.bedrijfsnaam} aan Batterijconcept.`,
        `Betaaltermijn ${RELATIE_FACTUUR_BETAALTERMIJN_DAGEN} dagen.`,
        `Incl. 21% btw. KvK ${partner.kvk_nummer}, IBAN ${partner.iban}.`,
      ].join(" "),
    })
    .select("id")
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
      };
    }
    // Race: parallel create → hergebruik
    if (insErr?.code === "23505") {
      const { data: again } = await sb
        .from("partner_creditfacturen")
        .select("id")
        .eq("partner_id", partner.id)
        .eq("project_nummer", project.project_nummer)
        .neq("status", "geannuleerd")
        .maybeSingle();
      if (again) {
        return {
          ok: true,
          created: false,
          creditfactuur_id: again.id as string,
          skipped: "race",
        };
      }
    }
    return { ok: false, error: insErr?.message || "CF aanmaken mislukt" };
  }

  return {
    ok: true,
    created: true,
    creditfactuur_id: created.id as string,
  };
}

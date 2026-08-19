import type { SupabaseClient } from "@supabase/supabase-js";
import { STANDAARD_INSTALLATIEKOSTEN } from "@/lib/project-kosten";

/** Maakt een project aan voor een ondertekende offerte (idempotent). */
export async function ensureProjectForOfferte(
  sb: SupabaseClient,
  opts: {
    offerteId: string;
    leadId: string;
    offerteNummer: string;
    titel?: string | null;
    klantNaam?: string | null;
  }
): Promise<{ id: string; project_nummer: string; created: boolean } | null> {
  const { data: offerteMeta } = await sb
    .from("offertes")
    .select(
      "installatie_partner_id, installatie_partners(naam), aanbetaling_te_innen_inc, backoffice_notitie, installateur_notitie"
    )
    .eq("id", opts.offerteId)
    .maybeSingle();

  const partnerId =
    (offerteMeta as { installatie_partner_id?: string | null } | null)
      ?.installatie_partner_id || null;
  const aanbetalingTeInnen =
    (
      offerteMeta as { aanbetaling_te_innen_inc?: number | null } | null
    )?.aanbetaling_te_innen_inc ?? null;
  const backofficeNotitie =
    (
      offerteMeta as { backoffice_notitie?: string | null } | null
    )?.backoffice_notitie ?? null;
  const installateurNotitie =
    (
      offerteMeta as { installateur_notitie?: string | null } | null
    )?.installateur_notitie ?? null;
  const partnerJoin = (
    offerteMeta as {
      installatie_partners?:
        | { naam?: string | null }
        | { naam?: string | null }[]
        | null;
    } | null
  )?.installatie_partners;
  const partnerNaam = Array.isArray(partnerJoin)
    ? partnerJoin[0]?.naam
    : partnerJoin?.naam;

  const { data: existing } = await sb
    .from("projecten")
    .select("id, project_nummer, installatie_partner_id")
    .eq("offerte_id", opts.offerteId)
    .maybeSingle();

  if (existing?.id) {
    // Partner van offerte alsnog overnemen als project die nog mist
    if (partnerId && !existing.installatie_partner_id) {
      await sb
        .from("projecten")
        .update({
          installatie_partner_id: partnerId,
          ...(partnerNaam ? { monteur: partnerNaam } : {}),
        })
        .eq("id", existing.id);
    }
    return {
      id: existing.id,
      project_nummer: existing.project_nummer,
      created: false,
    };
  }

  const { data: nummer, error: numErr } = await sb.rpc(
    "generate_project_nummer"
  );
  if (numErr || !nummer) {
    console.error("generate_project_nummer:", numErr);
    return null;
  }

  const titel =
    opts.titel?.trim() ||
    (opts.klantNaam
      ? `Thuisbatterij — ${opts.klantNaam}`
      : `Project bij ${opts.offerteNummer}`);

  const insertRow: Record<string, unknown> = {
    lead_id: opts.leadId,
    offerte_id: opts.offerteId,
    project_nummer: nummer as string,
    status: "schouw_inplannen",
    titel,
    notities: `Automatisch aangemaakt na ondertekening van ${opts.offerteNummer}.`,
    projectkosten: STANDAARD_INSTALLATIEKOSTEN,
    aanbetaling_te_innen_inc: aanbetalingTeInnen,
    backoffice_notitie: backofficeNotitie,
    installateur_notitie: installateurNotitie,
  };
  if (partnerId) {
    insertRow.installatie_partner_id = partnerId;
    if (partnerNaam) insertRow.monteur = partnerNaam;
  }

  let { data: created, error } = await sb
    .from("projecten")
    .insert(insertRow)
    .select("id, project_nummer")
    .single();

  // Kolom ontbreekt nog → opnieuw zonder partner
  if (
    error &&
    (error.message?.includes("installatie_partner_id") ||
      error.message?.includes("aanbetaling_te_innen_inc") ||
      error.message?.includes("backoffice_notitie") ||
      error.message?.includes("installateur_notitie") ||
      error.code === "42703")
  ) {
    delete insertRow.installatie_partner_id;
    delete insertRow.aanbetaling_te_innen_inc;
    delete insertRow.backoffice_notitie;
    delete insertRow.installateur_notitie;
    const retry = await sb
      .from("projecten")
      .insert(insertRow)
      .select("id, project_nummer")
      .single();
    created = retry.data;
    error = retry.error;
  }

  if (error || !created) {
    console.error("Project aanmaken:", error);
    return null;
  }

  return {
    id: created.id,
    project_nummer: created.project_nummer,
    created: true,
  };
}

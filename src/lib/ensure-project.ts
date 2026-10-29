import type { SupabaseClient } from "@supabase/supabase-js";
import { getDefaultBackofficeMedewerkerId } from "@/lib/admin-adviseur";
import { STANDAARD_INSTALLATIEKOSTEN } from "@/lib/project-kosten";
import { resolveBetaalwijze } from "@/lib/project-status-config";

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
      "installatie_partner_id, installatie_partners(naam), aanbetaling_te_innen_inc, backoffice_notitie, installateur_notitie, backoffice_notitie_door, installateur_notitie_door, elektra_verbruik_kwh, gas_verbruik_m3, teruglevering_kwh, energie_contract_type, energie_contract_einddatum, financiering_voorbehoud, leads(status)"
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
  const backofficeNotitieDoor =
    (
      offerteMeta as { backoffice_notitie_door?: string | null } | null
    )?.backoffice_notitie_door ?? null;
  const installateurNotitieDoor =
    (
      offerteMeta as { installateur_notitie_door?: string | null } | null
    )?.installateur_notitie_door ?? null;
  const energieMeta = offerteMeta as {
    elektra_verbruik_kwh?: number | null;
    gas_verbruik_m3?: number | null;
    teruglevering_kwh?: number | null;
    energie_contract_type?: string | null;
    energie_contract_einddatum?: string | null;
  } | null;
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

  const leadJoin = (
    offerteMeta as {
      leads?:
        | { status?: string | null }
        | { status?: string | null }[]
        | null;
      financiering_voorbehoud?: boolean | null;
    } | null
  )?.leads;
  const leadStatus = Array.isArray(leadJoin)
    ? leadJoin[0]?.status
    : leadJoin?.status;
  const betaalwijze = resolveBetaalwijze({
    leadStatus,
    financieringVoorbehoud: (
      offerteMeta as { financiering_voorbehoud?: boolean | null } | null
    )?.financiering_voorbehoud,
  });

  const defaultBackofficeId = await getDefaultBackofficeMedewerkerId(sb);

  const { data: existing } = await sb
    .from("projecten")
    .select("id, project_nummer, installatie_partner_id, verantwoordelijke_id")
    .eq("offerte_id", opts.offerteId)
    .maybeSingle();

  if (existing?.id) {
    const patch: Record<string, unknown> = {};
    // Partner van offerte alsnog overnemen als project die nog mist
    if (partnerId && !existing.installatie_partner_id) {
      patch.installatie_partner_id = partnerId;
      if (partnerNaam) patch.monteur = partnerNaam;
    }
    if (defaultBackofficeId && !existing.verantwoordelijke_id) {
      patch.verantwoordelijke_id = defaultBackofficeId;
    }
    // Sale-type syncen (eigen middelen ↔ Warmtefonds)
    patch.betaalwijze = betaalwijze;
    if (aanbetalingTeInnen != null) {
      patch.aanbetaling_te_innen_inc = aanbetalingTeInnen;
    }
    if (energieMeta?.elektra_verbruik_kwh != null) {
      patch.elektra_verbruik_kwh = energieMeta.elektra_verbruik_kwh;
      patch.gas_verbruik_m3 = energieMeta.gas_verbruik_m3 ?? null;
      patch.teruglevering_kwh = energieMeta.teruglevering_kwh ?? null;
      patch.energie_contract_type = energieMeta.energie_contract_type ?? null;
      patch.energie_contract_einddatum =
        energieMeta.energie_contract_einddatum ?? null;
    }
    if (Object.keys(patch).length > 0) {
      await sb.from("projecten").update(patch).eq("id", existing.id);
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
    status: "schouwweek_inplannen",
    titel,
    notities: `Aangemaakt na afronden backoffice-actie voor ${opts.offerteNummer}.`,
    projectkosten: STANDAARD_INSTALLATIEKOSTEN,
    aanbetaling_te_innen_inc: aanbetalingTeInnen,
    backoffice_notitie: backofficeNotitie,
    installateur_notitie: installateurNotitie,
    backoffice_notitie_door: backofficeNotitieDoor,
    installateur_notitie_door: installateurNotitieDoor,
    elektra_verbruik_kwh: energieMeta?.elektra_verbruik_kwh ?? null,
    gas_verbruik_m3: energieMeta?.gas_verbruik_m3 ?? null,
    teruglevering_kwh: energieMeta?.teruglevering_kwh ?? null,
    energie_contract_type: energieMeta?.energie_contract_type ?? null,
    energie_contract_einddatum: energieMeta?.energie_contract_einddatum ?? null,
    backoffice_afgerond_at: new Date().toISOString(),
    betaalwijze,
  };
  if (defaultBackofficeId) {
    insertRow.verantwoordelijke_id = defaultBackofficeId;
  }
  if (partnerId) {
    insertRow.installatie_partner_id = partnerId;
    if (partnerNaam) insertRow.monteur = partnerNaam;
  }

  let { data: created, error } = await sb
    .from("projecten")
    .insert(insertRow)
    .select("id, project_nummer")
    .single();

  // Kolom ontbreekt nog → opnieuw zonder optionele velden
  if (
    error &&
    (error.message?.includes("installatie_partner_id") ||
      error.message?.includes("aanbetaling_te_innen_inc") ||
      error.message?.includes("backoffice_notitie") ||
      error.message?.includes("installateur_notitie") ||
      error.message?.includes("backoffice_afgerond_at") ||
      error.message?.includes("betaalwijze") ||
      error.message?.includes("verantwoordelijke_id") ||
      error.code === "42703")
  ) {
    delete insertRow.installatie_partner_id;
    delete insertRow.aanbetaling_te_innen_inc;
    delete insertRow.backoffice_notitie;
    delete insertRow.installateur_notitie;
    delete insertRow.backoffice_notitie_door;
    delete insertRow.installateur_notitie_door;
    delete insertRow.elektra_verbruik_kwh;
    delete insertRow.gas_verbruik_m3;
    delete insertRow.teruglevering_kwh;
    delete insertRow.energie_contract_type;
    delete insertRow.energie_contract_einddatum;
    delete insertRow.backoffice_afgerond_at;
    delete insertRow.betaalwijze;
    delete insertRow.verantwoordelijke_id;
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

  try {
    const { syncAutoTakenVoorProject } = await import("@/lib/sync-auto-taken");
    await syncAutoTakenVoorProject(sb, created.id, "schouwweek_inplannen");
  } catch (e) {
    console.error("Auto-taken na project:", e);
  }

  try {
    const { ensureAdviseurOrderCommissieConcept } = await import(
      "@/lib/netto-creditfactuur"
    );
    await ensureAdviseurOrderCommissieConcept(sb, {
      leadId: opts.leadId,
      offerteId: opts.offerteId,
      offerteNummer: opts.offerteNummer,
      projectNummer: created.project_nummer,
    });
  } catch (e) {
    console.error("Adviseur commissie-concept na project:", e);
  }

  return {
    id: created.id,
    project_nummer: created.project_nummer,
    created: true,
  };
}

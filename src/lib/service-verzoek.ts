import type { SupabaseClient } from "@supabase/supabase-js";
import { logLeadEvent } from "@/lib/lead-events";
import { VERVOLG_OPLEVERFORMULIER_LABEL } from "@/lib/oplever-formulier";

/** Onderwerp van het verzoek dat het opleverformulier aanmaakt. */
export const VERVOLG_OPLEVERFORMULIER_ONDERWERP =
  VERVOLG_OPLEVERFORMULIER_LABEL;

/**
 * Open serviceverzoek na restpunt op het opleverformulier.
 * Geen klantmail. Zet de orderstatus niet op `service` (after sale blijft lopen).
 */
export async function ensureOpleverVervolgServiceVerzoek(
  sb: SupabaseClient,
  opts: {
    projectId: string;
    leadId: string | null | undefined;
    omschrijving: string;
    bestaandeId?: string | null;
  }
): Promise<string | null> {
  const bestaande = opts.bestaandeId?.trim() || "";
  if (bestaande) {
    const { data } = await sb
      .from("service_verzoeken")
      .select("id")
      .eq("id", bestaande)
      .eq("project_id", opts.projectId)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  const { data: open } = await sb
    .from("service_verzoeken")
    .select("id")
    .eq("project_id", opts.projectId)
    .eq("onderwerp", VERVOLG_OPLEVERFORMULIER_ONDERWERP)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open?.id) return open.id;

  const leadId = opts.leadId?.trim() || "";
  if (!leadId) return null;

  const insertRow = {
    project_id: opts.projectId,
    lead_id: leadId,
    onderwerp: VERVOLG_OPLEVERFORMULIER_ONDERWERP,
    omschrijving: opts.omschrijving.trim() || null,
    status: "open" as const,
  };

  const { data, error } = await sb
    .from("service_verzoeken")
    .insert(insertRow)
    .select("id")
    .single();
  if (error || !data?.id) {
    console.error("oplever serviceverzoek:", error?.message);
    return null;
  }

  await logLeadEvent({
    leadId,
    soort: "service",
    titel: `Serviceverzoek: ${VERVOLG_OPLEVERFORMULIER_ONDERWERP}`,
    detail: opts.omschrijving.trim() || null,
    meta: {
      service_verzoek_id: data.id,
      project_id: opts.projectId,
      bron: "opleverformulier",
    },
  });

  return data.id;
}

/** Zet project op Service zolang er open verzoeken zijn, anders Installatie voltooid. */
export async function syncProjectServiceStatus(
  sb: SupabaseClient,
  projectId: string
): Promise<void> {
  const { count } = await sb
    .from("service_verzoeken")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "open");

  const nextStatus =
    (count ?? 0) > 0 ? "service" : "installatie_voltooid";

  await sb.from("projecten").update({ status: nextStatus }).eq("id", projectId);
}

/**
 * Zoekt het juiste project bij een klant-email:
 * lead via email → meest passende project (service / voltooid / recentst).
 */
export async function findProjectByKlantEmail(
  sb: SupabaseClient,
  email: string
): Promise<{
  project: {
    id: string;
    lead_id: string;
    project_nummer: string;
    status: string;
    titel: string | null;
  };
  lead: { id: string; naam: string; email: string | null; lead_number: string };
} | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const { data: lead } = await sb
    .from("leads")
    .select("id, naam, email, lead_number")
    .ilike("email", normalized)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lead) return null;

  const { data: projects } = await sb
    .from("projecten")
    .select("id, lead_id, project_nummer, status, titel, created_at")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false });

  if (!projects || projects.length === 0) return null;

  const pick =
    projects.find((p) => p.status === "service") ||
    projects.find((p) => p.status === "installatie_voltooid") ||
    projects[0];

  return {
    project: {
      id: pick.id,
      lead_id: pick.lead_id,
      project_nummer: pick.project_nummer,
      status: pick.status,
      titel: pick.titel,
    },
    lead,
  };
}

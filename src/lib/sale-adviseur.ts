import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Adviseur die de sale heeft gemaakt:
 * 1) offerte.aangemaakt_door_id
 * 2) lead.adviseur_id
 */
export async function resolveSaleAdviseurId(
  sb: SupabaseClient,
  projectId: string
): Promise<string | null> {
  const { data: project } = await sb
    .from("projecten")
    .select(
      "lead_id, offerte_id, leads(adviseur_id), offertes(aangemaakt_door_id)"
    )
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return null;

  const off = Array.isArray(project.offertes)
    ? project.offertes[0]
    : project.offertes;
  const fromOfferte =
    (off as { aangemaakt_door_id?: string | null } | null)?.aangemaakt_door_id ||
    null;
  if (fromOfferte) return fromOfferte;

  const lead = Array.isArray(project.leads) ? project.leads[0] : project.leads;
  const fromLead =
    (lead as { adviseur_id?: string | null } | null)?.adviseur_id || null;
  if (fromLead) return fromLead;

  // Fallback: lead.adviseur_id via aparte query als join geen adviseur gaf
  if (project.lead_id) {
    const { data: leadRow } = await sb
      .from("leads")
      .select("adviseur_id")
      .eq("id", project.lead_id)
      .maybeSingle();
    if (leadRow?.adviseur_id) return leadRow.adviseur_id as string;
  }

  if (project.offerte_id) {
    const { data: offRow } = await sb
      .from("offertes")
      .select("aangemaakt_door_id")
      .eq("id", project.offerte_id)
      .maybeSingle();
    if (offRow?.aangemaakt_door_id) return offRow.aangemaakt_door_id as string;
  }

  return null;
}

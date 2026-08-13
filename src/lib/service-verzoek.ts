import type { SupabaseClient } from "@supabase/supabase-js";

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

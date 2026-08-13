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

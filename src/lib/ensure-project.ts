import type { SupabaseClient } from "@supabase/supabase-js";

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
  const { data: existing } = await sb
    .from("projecten")
    .select("id, project_nummer")
    .eq("offerte_id", opts.offerteId)
    .maybeSingle();

  if (existing?.id) {
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

  const { data: created, error } = await sb
    .from("projecten")
    .insert({
      lead_id: opts.leadId,
      offerte_id: opts.offerteId,
      project_nummer: nummer as string,
      status: "schouw_inplannen",
      titel,
      notities: `Automatisch aangemaakt na ondertekening van ${opts.offerteNummer}.`,
    })
    .select("id, project_nummer")
    .single();

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

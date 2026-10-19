import type { SupabaseClient } from "@supabase/supabase-js";
import type { RelatieKind } from "@/lib/relatie-contract";

export type RelatieActiviteit = {
  id: string;
  kind: RelatieKind;
  relatie_id: string;
  soort: string;
  titel: string;
  detail: string | null;
  created_at: string;
  created_by?: string | null;
};

export async function logRelatieActiviteit(
  sb: SupabaseClient,
  opts: {
    kind: RelatieKind;
    relatieId: string;
    soort: string;
    titel: string;
    detail?: string | null;
    createdBy?: string | null;
  }
): Promise<void> {
  try {
    const { error } = await sb.from("relatie_activiteit").insert({
      kind: opts.kind,
      relatie_id: opts.relatieId,
      soort: opts.soort,
      titel: opts.titel,
      detail: opts.detail?.trim() || null,
      created_by: opts.createdBy || null,
    });
    if (error) {
      /* tabel ontbreekt tot migratie — stil negeren */
    }
  } catch {
    /* non-blocking */
  }
}

export async function listRelatieActiviteit(
  sb: SupabaseClient,
  kind: RelatieKind,
  relatieId: string,
  limit = 40
): Promise<RelatieActiviteit[]> {
  const { data, error } = await sb
    .from("relatie_activiteit")
    .select(
      "id, kind, relatie_id, soort, titel, detail, created_at, created_by"
    )
    .eq("kind", kind)
    .eq("relatie_id", relatieId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (
      error.code === "42P01" ||
      error.message?.includes("relatie_activiteit")
    ) {
      return [];
    }
    throw error;
  }
  return (data || []) as RelatieActiviteit[];
}

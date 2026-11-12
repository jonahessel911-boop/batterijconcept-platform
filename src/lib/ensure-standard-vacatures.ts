import type { SupabaseClient } from "@supabase/supabase-js";
import {
  STANDARD_RECRUITMENT_VACATURES,
  isStandardVacatureTitel,
} from "@/lib/recruitment-rollen";
import type { RecruitmentVacature } from "@/types/database";

/**
 * Zorgt dat de standaardvacatures bestaan.
 * Idempotent — veilig bij elke Jobs/GET-call.
 * Status (open/dicht) wordt niet overschreven.
 */
export async function ensureStandardVacatures(
  sb: SupabaseClient
): Promise<RecruitmentVacature[]> {
  const { data: existing, error } = await sb
    .from("recruitment_vacatures")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (existing || []) as RecruitmentVacature[];
  const byTitel = new Map(
    rows.map((r) => [r.titel.trim().toLowerCase(), r] as const)
  );

  const now = new Date().toISOString();

  for (const std of STANDARD_RECRUITMENT_VACATURES) {
    const key = std.titel.toLowerCase();
    const found = byTitel.get(key);
    if (!found) {
      const { data: inserted, error: insertErr } = await sb
        .from("recruitment_vacatures")
        .insert({
          titel: std.titel,
          rol: std.rol,
          status: "open",
          korte_omschrijving: std.korte_omschrijving,
          sort_order: std.sort_order,
          updated_at: now,
        })
        .select("*")
        .single();
      if (insertErr) throw insertErr;
      if (inserted) {
        rows.push(inserted as RecruitmentVacature);
        byTitel.set(key, inserted as RecruitmentVacature);
      }
      continue;
    }

    const needsPatch =
      found.rol !== std.rol ||
      found.sort_order !== std.sort_order ||
      (found.korte_omschrijving || null) !== std.korte_omschrijving;

    if (!needsPatch) continue;

    const { data: updated, error: updateErr } = await sb
      .from("recruitment_vacatures")
      .update({
        rol: std.rol,
        sort_order: std.sort_order,
        korte_omschrijving: std.korte_omschrijving,
        updated_at: now,
      })
      .eq("id", found.id)
      .select("*")
      .single();
    if (updateErr) throw updateErr;
    if (updated) {
      const idx = rows.findIndex((r) => r.id === found.id);
      if (idx >= 0) rows[idx] = updated as RecruitmentVacature;
      byTitel.set(key, updated as RecruitmentVacature);
    }
  }

  return rows
    .slice()
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
}

export { isStandardVacatureTitel };

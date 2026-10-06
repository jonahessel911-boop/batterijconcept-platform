import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectStatus } from "@/types/database";
import { isOpleveringsrapport } from "@/lib/project-documenten";
import { ensurePartnerInstallatieCreditfactuur } from "@/lib/partner-installatie-creditfactuur";
import { ensureAdviseurCommissieTrancheB } from "@/lib/netto-creditfactuur";

/**
 * Na upload opleveringsrapport (met klant-handtekening):
 * zet status op installatie_voltooid + concept creditfactuur voor partner.
 */
export async function maybeAdvanceProjectNaOplevering(
  sb: SupabaseClient,
  projectId: string
): Promise<{
  advanced: boolean;
  from: string | null;
  to: ProjectStatus | null;
  project?: Record<string, unknown> | null;
  creditfactuur_id?: string | null;
}> {
  const { data: project, error } = await sb
    .from("projecten")
    .select("id, status, project_nummer")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !project) {
    return { advanced: false, from: null, to: null };
  }

  const current = (project.status as string) || "";
  if (
    current === "annulering" ||
    current === "installatie_voltooid" ||
    current === "review_gevraagd" ||
    current === "service"
  ) {
    return { advanced: false, from: current, to: null };
  }

  const { data: fotos } = await sb
    .from("project_fotos")
    .select("id, omschrijving")
    .eq("project_id", projectId);

  const hasRapport = (fotos || []).some((f) =>
    isOpleveringsrapport(f.omschrijving)
  );
  if (!hasRapport) {
    return { advanced: false, from: current, to: null };
  }

  const to: ProjectStatus = "installatie_voltooid";
  const { data: updated, error: updErr } = await sb
    .from("projecten")
    .update({ status: to })
    .eq("id", projectId)
    .select(
      "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon), offertes(id, offerte_nummer, totaal_inc_btw)"
    )
    .maybeSingle();

  if (updErr) {
    console.error("maybeAdvanceProjectNaOplevering:", updErr.message);
    return { advanced: false, from: current, to: null };
  }

  let creditfactuur_id: string | null = null;
  try {
    const cf = await ensurePartnerInstallatieCreditfactuur(sb, projectId);
    if (cf.ok && cf.creditfactuur_id) {
      creditfactuur_id = cf.creditfactuur_id;
    } else if (!cf.ok) {
      console.error(
        "ensurePartnerInstallatieCreditfactuur:",
        cf.error || cf.skipped
      );
    }
  } catch (e) {
    console.error("ensurePartnerInstallatieCreditfactuur:", e);
  }

  try {
    const advCf = await ensureAdviseurCommissieTrancheB(sb, projectId);
    if (!advCf.ok) {
      console.error(
        "ensureAdviseurCommissieTrancheB:",
        advCf.error || advCf.skipped
      );
    }
  } catch (e) {
    console.error("ensureAdviseurCommissieTrancheB:", e);
  }

  return {
    advanced: true,
    from: current,
    to,
    project: (updated as Record<string, unknown>) || null,
    creditfactuur_id,
  };
}

/** Controle of er al een opleveringsrapport staat (voor status-gate). */
export async function projectHeeftOpleveringsrapport(
  sb: SupabaseClient,
  projectId: string
): Promise<boolean> {
  const { data: fotos } = await sb
    .from("project_fotos")
    .select("id, omschrijving")
    .eq("project_id", projectId);
  return (fotos || []).some((f) => isOpleveringsrapport(f.omschrijving));
}

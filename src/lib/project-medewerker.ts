import type { SupabaseClient } from "@supabase/supabase-js";
import type { InstallatiePartnerTeamgenoot, Project } from "@/types/database";

/** Gekoppelde medewerker (teamgenoot) van een project. */
export function teamgenootVanProject(
  project: Pick<Project, "installatie_teamgenoot" | "installatie_teamgenoot_id">
): Pick<InstallatiePartnerTeamgenoot, "id" | "naam" | "email" | "telefoon"> | null {
  const raw = project.installatie_teamgenoot;
  const one = Array.isArray(raw) ? raw[0] : raw;
  if (one && typeof one === "object" && one.id) {
    return {
      id: one.id,
      naam: one.naam || "",
      email: one.email ?? null,
      telefoon: one.telefoon ?? null,
    };
  }
  return null;
}

/**
 * Naam van de uitvoerende persoon — nooit de partner/bedrijfsnaam.
 * Volgorde: override → teamgenoot → project.monteur.
 */
export function medewerkerNaamVanProject(
  project: Pick<
    Project,
    "monteur" | "installatie_teamgenoot" | "installatie_teamgenoot_id"
  >,
  override?: string | null
): string {
  if (override?.trim()) return override.trim();
  const tg = teamgenootVanProject(project);
  if (tg?.naam?.trim()) return tg.naam.trim();
  return (project.monteur || "").trim();
}

/**
 * Bepaal de monteur-naam voor op de PDF: teamgenoot → project.monteur → fallback.
 */
export async function resolveMonteurNaamVoorPdf(
  sb: SupabaseClient,
  projectId: string,
  opts?: {
    teamgenootId?: string | null;
    fallbackNaam?: string | null;
  }
): Promise<string> {
  const fallback = (opts?.fallbackNaam || "").trim();
  const hint = opts?.teamgenootId?.trim() || null;

  const { data: project } = await sb
    .from("projecten")
    .select("installatie_partner_id, installatie_teamgenoot_id, monteur")
    .eq("id", projectId)
    .maybeSingle();

  const partnerId = project?.installatie_partner_id || null;
  const tgId = hint || project?.installatie_teamgenoot_id || null;

  if (tgId) {
    let q = sb
      .from("installatie_partner_teamgenoten")
      .select("id, naam, partner_id, actief")
      .eq("id", tgId);
    if (partnerId) q = q.eq("partner_id", partnerId);
    const { data: tg } = await q.maybeSingle();
    if (tg && tg.actief !== false && (tg.naam || "").trim()) {
      return (tg.naam || "").trim();
    }
  }

  const monteur = (project?.monteur || "").trim();
  return monteur || fallback;
}

/**
 * Zet/werkt installatie_teamgenoot_id + monteur bij op basis van de
 * naam op schouw-/opleverformulier.
 */
export async function syncProjectMedewerkerVanNaam(
  sb: SupabaseClient,
  projectId: string,
  naamRaw: string,
  teamgenootIdHint?: string | null
): Promise<void> {
  const naam = naamRaw.trim();
  if (!naam && !teamgenootIdHint) return;

  const { data: project, error } = await sb
    .from("projecten")
    .select("id, installatie_partner_id, installatie_teamgenoot_id, monteur")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !project) return;

  const partnerId = (project as { installatie_partner_id?: string | null })
    .installatie_partner_id;
  let teamgenootId =
    teamgenootIdHint?.trim() ||
    (project as { installatie_teamgenoot_id?: string | null })
      .installatie_teamgenoot_id ||
    null;
  let monteurNaam = naam;

  if (teamgenootId) {
    const { data: tg } = await sb
      .from("installatie_partner_teamgenoten")
      .select("id, naam, partner_id, actief")
      .eq("id", teamgenootId)
      .maybeSingle();
    if (
      tg &&
      tg.actief !== false &&
      (!partnerId || tg.partner_id === partnerId)
    ) {
      monteurNaam = (tg.naam || "").trim() || monteurNaam;
    } else {
      teamgenootId = null;
    }
  }

  if (!teamgenootId && partnerId && naam) {
    const { data: matches } = await sb
      .from("installatie_partner_teamgenoten")
      .select("id, naam")
      .eq("partner_id", partnerId)
      .eq("actief", true)
      .ilike("naam", naam);
    const exact = (matches || []).find(
      (t) => (t.naam || "").trim().toLowerCase() === naam.toLowerCase()
    );
    if (exact?.id) {
      teamgenootId = exact.id;
      monteurNaam = (exact.naam || "").trim() || monteurNaam;
    }
  }

  const patch: Record<string, unknown> = {};
  if (monteurNaam) patch.monteur = monteurNaam;
  if (teamgenootId) patch.installatie_teamgenoot_id = teamgenootId;

  if (Object.keys(patch).length === 0) return;

  const curTg = (project as { installatie_teamgenoot_id?: string | null })
    .installatie_teamgenoot_id;
  const curMonteur = ((project as { monteur?: string | null }).monteur || "")
    .trim();
  if (
    curTg === (patch.installatie_teamgenoot_id ?? curTg) &&
    curMonteur === ((patch.monteur as string) || curMonteur)
  ) {
    return;
  }

  await sb.from("projecten").update(patch).eq("id", projectId);
}

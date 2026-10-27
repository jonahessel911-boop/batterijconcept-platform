import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectStatus } from "@/types/database";
import { isOpleveringsrapport } from "@/lib/project-documenten";
import { ensurePartnerInstallatieCreditfactuur } from "@/lib/partner-installatie-creditfactuur";
import { ensureAdviseurCommissieTrancheB } from "@/lib/netto-creditfactuur";

async function ensureOpleveringAfrondTaken(
  sb: SupabaseClient,
  projectId: string,
  status: string
): Promise<void> {
  try {
    const { syncAutoTakenVoorProject } = await import("@/lib/sync-auto-taken");
    await syncAutoTakenVoorProject(sb, projectId, status);
  } catch (e) {
    console.error("ensureOpleveringAfrondTaken:", e);
  }
}

/**
 * Na upload opleveringsrapport / opleverformulier (handtekening installateur):
 * zet status op installatie_voltooid + concept creditfactuur voor partner
 * + 2 backoffice-acties (overstap dynamische leverancier + BTW terugvrage, deadline 2 dagen).
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
  if (current === "annulering") {
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

  // Al op installatie_voltooid: afrond-taken alsnog zekerstellen (idempotent)
  if (current === "installatie_voltooid") {
    await ensureOpleveringAfrondTaken(sb, projectId, current);
    return { advanced: false, from: current, to: null };
  }
  if (current === "review_gevraagd" || current === "service") {
    return { advanced: false, from: current, to: null };
  }

  const to: ProjectStatus = "installatie_voltooid";
  const selectCols =
    "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon), offertes(id, offerte_nummer, totaal_inc_btw)";
  let { data: updated, error: updErr } = await sb
    .from("projecten")
    .update({
      status: to,
      installatie_voltooid_at: new Date().toISOString(),
    })
    .eq("id", projectId)
    .select(selectCols)
    .maybeSingle();

  if (
    updErr &&
    (updErr.message?.includes("installatie_voltooid_at") ||
      updErr.code === "42703")
  ) {
    const retry = await sb
      .from("projecten")
      .update({ status: to })
      .eq("id", projectId)
      .select(selectCols)
      .maybeSingle();
    updated = retry.data;
    updErr = retry.error;
  }

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

  // Eigen middelen: 50% restantfactuur ná installatie
  try {
    const { ensureRestantDraftFactuur } = await import(
      "@/lib/ensure-btw-factuur"
    );
    const { isWarmtefondsSale } = await import("@/lib/backoffice-acties");
    const { data: full } = await sb
      .from("projecten")
      .select(
        "id, lead_id, project_nummer, betaalwijze, offerte_id, leads(status), offertes(id, offerte_nummer, totaal_inc_btw, subtotaal_ex_btw, financiering_voorbehoud)"
      )
      .eq("id", projectId)
      .maybeSingle();
    if (full) {
      const lead = Array.isArray(full.leads) ? full.leads[0] : full.leads;
      const off = Array.isArray(full.offertes)
        ? full.offertes[0]
        : full.offertes;
      const warmtefonds =
        full.betaalwijze === "warmtefonds"
          ? true
          : full.betaalwijze === "eigen_middelen"
            ? false
            : isWarmtefondsSale({
                leadStatus: (lead as { status?: string | null } | null)?.status,
                financieringVoorbehoud: (
                  off as { financiering_voorbehoud?: boolean | null } | null
                )?.financiering_voorbehoud,
              });
      const offerteId =
        (off as { id?: string } | null)?.id ||
        (full.offerte_id as string | null);
      if (!warmtefonds && offerteId && full.lead_id) {
        await ensureRestantDraftFactuur(sb, {
          offerteId,
          leadId: full.lead_id as string,
          projectId,
          offerteNummer:
            (off as { offerte_nummer?: string } | null)?.offerte_nummer ||
            (full.project_nummer as string) ||
            "order",
          orderIncBtw:
            Number(
              (off as { totaal_inc_btw?: number | null } | null)?.totaal_inc_btw
            ) || 0,
          orderExBtw:
            (off as { subtotaal_ex_btw?: number | null } | null)
              ?.subtotaal_ex_btw != null
              ? Number(
                  (off as { subtotaal_ex_btw?: number | null }).subtotaal_ex_btw
                )
              : null,
          warmtefonds: false,
        });
      }
    }
  } catch (e) {
    console.error("ensureRestantDraftFactuur (eigen middelen):", e);
  }

  await ensureOpleveringAfrondTaken(sb, projectId, to);

  // Klantmail: gefeliciteerd, batterij staat er + aankondiging overstap/BTW
  try {
    await sendInstallatieVoltooidKlantMail(sb, projectId, updated);
  } catch (e) {
    console.error("sendInstallatieVoltooidKlantMail:", e);
  }

  return {
    advanced: true,
    from: current,
    to,
    project: (updated as Record<string, unknown>) || null,
    creditfactuur_id,
  };
}

async function sendInstallatieVoltooidKlantMail(
  sb: SupabaseClient,
  projectId: string,
  updated: Record<string, unknown> | null | undefined
): Promise<void> {
  const { sendEmail } = await import("@/lib/email/postmark");
  const { installatieVoltooidKlantEmail } = await import(
    "@/lib/email/templates"
  );

  let lead = updated?.leads as
    | { naam?: string | null; email?: string | null }
    | { naam?: string | null; email?: string | null }[]
    | null
    | undefined;
  if (Array.isArray(lead)) lead = lead[0] ?? null;

  let email = lead?.email?.trim() || "";
  let naam = lead?.naam?.trim() || "daar";
  const projectNummer =
    (updated?.project_nummer as string | null | undefined) || null;

  if (!email) {
    const { data: row } = await sb
      .from("projecten")
      .select("project_nummer, leads(naam, email)")
      .eq("id", projectId)
      .maybeSingle();
    const l = Array.isArray(row?.leads) ? row?.leads[0] : row?.leads;
    email = (l as { email?: string | null } | null)?.email?.trim() || "";
    naam =
      (l as { naam?: string | null } | null)?.naam?.trim() || naam;
  }

  if (!email) {
    console.warn(
      "installatieVoltooidKlantMail: geen klant-email voor project",
      projectId
    );
    return;
  }

  const html = installatieVoltooidKlantEmail({
    naam,
    projectNummer,
  });
  const sent = await sendEmail({
    to: email,
    subject: "Gefeliciteerd — je installatie is voltooid!",
    html,
    tag: "installatie-voltooid",
  });
  if (!sent.ok) {
    console.error("installatieVoltooidKlantMail failed:", sent.error);
  }
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

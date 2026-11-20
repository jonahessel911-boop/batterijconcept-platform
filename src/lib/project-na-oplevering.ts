import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectStatus } from "@/types/database";
import { isOpleveringsrapportBewijs } from "@/lib/project-documenten";
import { parseOpleverFormulierSnapshot } from "@/lib/oplever-formulier";
import { ensurePartnerInstallatieCreditfactuur } from "@/lib/partner-installatie-creditfactuur";
import { ensureAdviseurCommissieTrancheB } from "@/lib/netto-creditfactuur";

/**
 * Eindafrekening: na oplevering moet het hele offertebedrag gefactureerd zijn.
 * Bij Warmtefonds dekt de restantfactuur maar max € 8.500 — het stuk daarboven
 * bleef anders ongefactureerd staan. Zet alleen een CONCEPT klaar.
 */
async function ensureEindafrekening(
  sb: SupabaseClient,
  projectId: string
): Promise<void> {
  try {
    const { ensureEindafrekeningVoorProject } = await import(
      "@/lib/ensure-btw-factuur"
    );
    await ensureEindafrekeningVoorProject(sb, projectId);
  } catch (e) {
    console.error("ensureEindafrekeningVoorProject:", e);
  }
}

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

const AFTER_SALE_OVERSLAAN = new Set([
  "annulering",
  "hold_sales_actie",
]);

function snapshotIsOpleverFormulier(raw: unknown): boolean {
  const snap = parseOpleverFormulierSnapshot(raw);
  if (!snap) return false;
  return Boolean(
    snap.akkoord || snap.sin || snap.afgevinkt.length > 0 || snap.monteurNaam
  );
}

/** Snapshot-formulier aanwezig, maar orderstatus nog niet After sale. */
export function projectMoetNaarAfterSale(project: {
  status?: string | null;
  oplever_formulier?: unknown;
}): boolean {
  const st = String(project.status || "");
  if (
    AFTER_SALE_OVERSLAAN.has(st) ||
    st === "after_sale" ||
    st === "afgerond"
  ) {
    return false;
  }
  return snapshotIsOpleverFormulier(project.oplever_formulier);
}

type OpleverAdvanceOpts = {
  /** Standaard: mail alleen bij eerste afronding (nog geen voltooid_at). */
  sendKlantMail?: boolean;
};

/**
 * Na upload opleveringsrapport / opleverformulier (handtekening installateur):
 * zet status op after_sale + concept creditfactuur voor partner
 * + backoffice-acties (overstap, BTW, review — deadline eerstvolgende werkdag na installatie).
 */
export async function maybeAdvanceProjectNaOplevering(
  sb: SupabaseClient,
  projectId: string,
  opts?: OpleverAdvanceOpts
): Promise<{
  advanced: boolean;
  from: string | null;
  to: ProjectStatus | null;
  project?: Record<string, unknown> | null;
  creditfactuur_id?: string | null;
}> {
  let { data: project, error } = await sb
    .from("projecten")
    .select(
      "id, status, project_nummer, oplever_formulier, installatie_voltooid_at"
    )
    .eq("id", projectId)
    .maybeSingle();
  if (
    error &&
    (error.code === "42703" || error.message?.includes("oplever_formulier"))
  ) {
    const retry = await sb
      .from("projecten")
      .select("id, status, project_nummer, installatie_voltooid_at")
      .eq("id", projectId)
      .maybeSingle();
    project = retry.data
      ? { ...retry.data, oplever_formulier: null }
      : retry.data;
    error = retry.error;
  }

  if (error || !project) {
    return { advanced: false, from: null, to: null };
  }

  const current = (project.status as string) || "";
  if (AFTER_SALE_OVERSLAAN.has(current)) {
    return { advanced: false, from: current, to: null };
  }

  const { data: fotos } = await sb
    .from("project_fotos")
    .select("id, omschrijving, bestandsnaam, storage_path")
    .eq("project_id", projectId);

  const hasRapport =
    snapshotIsOpleverFormulier(
      (project as { oplever_formulier?: unknown }).oplever_formulier
    ) ||
    (fotos || []).some((f) =>
      isOpleveringsrapportBewijs(
        f.omschrijving,
        f.bestandsnaam,
        f.storage_path
      )
    );
  // Minimum: opleverformulier. Foto batterij / video blokkeren de status niet.
  if (!hasRapport) {
    return { advanced: false, from: current, to: null };
  }

  // Al in after sale: taken + concept-CF alsnog zekerstellen
  if (current === "after_sale") {
    await ensureOpleveringAfrondTaken(sb, projectId, current);
    await ensureEindafrekening(sb, projectId);
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
    return {
      advanced: false,
      from: current,
      to: null,
      creditfactuur_id,
    };
  }
  if (current === "afgerond") {
    return { advanced: false, from: current, to: null };
  }

  const alreadyVoltooidAt = Boolean(
    (project as { installatie_voltooid_at?: string | null })
      .installatie_voltooid_at
  );
  const to: ProjectStatus = "after_sale";
  const voltooidAt =
    (project as { installatie_voltooid_at?: string | null })
      .installatie_voltooid_at || new Date().toISOString();
  const selectCols =
    "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon), offertes(id, offerte_nummer, totaal_inc_btw)";
  let { data: updated, error: updErr } = await sb
    .from("projecten")
    .update({
      status: to,
      installatie_voltooid_at: voltooidAt,
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

  if (
    updErr &&
    (updErr.message?.includes("after_sale") ||
      updErr.message?.includes("projecten_status_check") ||
      updErr.code === "23514")
  ) {
    const fallback: Record<string, unknown> = {
      status: "installatie_voltooid" as ProjectStatus,
      installatie_voltooid_at: new Date().toISOString(),
    };
    const retry = await sb
      .from("projecten")
      .update(fallback)
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

  // Ná de restantfactuur: wat dan nog ongefactureerd is (WF-plafond, geen
  // aanbetaling) als concept-eindafrekening klaarzetten.
  await ensureEindafrekening(sb, projectId);

  await ensureOpleveringAfrondTaken(sb, projectId, to);

  const sendMail =
    opts?.sendKlantMail !== false &&
    !alreadyVoltooidAt &&
    current !== "installatie_voltooid" &&
    current !== "review_gevraagd" &&
    current !== "service";
  if (sendMail) {
    try {
      await sendInstallatieVoltooidKlantMail(sb, projectId, updated);
    } catch (e) {
      console.error("sendInstallatieVoltooidKlantMail:", e);
    }
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
    .select("id, omschrijving, bestandsnaam, storage_path")
    .eq("project_id", projectId);
  return (fotos || []).some((f) =>
    isOpleveringsrapportBewijs(f.omschrijving, f.bestandsnaam, f.storage_path)
  );
}

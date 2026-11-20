import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOpleverFormulierPdf } from "@/lib/pdf-oplever-formulier";
import { uploadProjectFotoFile } from "@/lib/project-fotos";
import { OPLEVERINGSRAPPORT_OMSCHRIJVING } from "@/lib/project-documenten";
import { maybeAdvanceProjectNaOplevering } from "@/lib/project-na-oplevering";
import {
  OPLEVER_PUNTEN,
  formatServiceVvNotitie,
  snapshotOpleverFormulier,
  type OpleverFormulierData,
  type OpleverPuntId,
  validateOpleverFormulier,
} from "@/lib/oplever-formulier";
import {
  resolveMonteurNaamVoorPdf,
  syncProjectMedewerkerVanNaam,
} from "@/lib/project-medewerker";
import { normalizeSysteemSin } from "@/lib/systeem-sin";

const PUNT_IDS = new Set<string>(OPLEVER_PUNTEN.map((p) => p.id));

export async function generateAndUploadOpleverFormulier(
  sb: SupabaseClient,
  projectId: string,
  data: OpleverFormulierData,
  opts?: { teamgenootId?: string | null }
): Promise<
  | {
      foto: {
        id: string;
        project_id: string;
        storage_path: string;
        bestandsnaam: string | null;
        omschrijving: string | null;
        created_at: string;
        url: string | null;
      };
      status_advance: Awaited<
        ReturnType<typeof maybeAdvanceProjectNaOplevering>
      >;
      project?: Record<string, unknown> | null;
    }
  | { error: string; status: number; detail?: string }
> {
  const invalid = validateOpleverFormulier(data);
  if (invalid) return { error: invalid, status: 400 };

  const sin = normalizeSysteemSin(data.sin);

  // Uniek: zelfde SIN mag niet al op een ander project staan
  {
    const { data: dupes, error: dupErr } = await sb
      .from("projecten")
      .select("id, project_nummer")
      .eq("systeem_sin", sin)
      .neq("id", projectId)
      .limit(3);
    if (
      dupErr &&
      !(
        dupErr.code === "42703" ||
        dupErr.message?.includes("systeem_sin")
      )
    ) {
      return { error: dupErr.message, status: 500 };
    }
    if (!dupErr && Array.isArray(dupes) && dupes.length > 0) {
      const nr =
        (dupes[0] as { project_nummer?: string | null }).project_nummer ||
        "ander project";
      return {
        error: `Dit SIN staat al op ${nr}. Elk systeem heeft een uniek SIN.`,
        status: 409,
      };
    }
  }

  const monteurNaam = await resolveMonteurNaamVoorPdf(sb, projectId, {
    teamgenootId: opts?.teamgenootId,
    fallbackNaam: data.monteurNaam,
  });
  const pdfData: OpleverFormulierData = {
    ...data,
    sin,
    monteurNaam: monteurNaam || data.monteurNaam,
  };

  try {
    await syncProjectMedewerkerVanNaam(
      sb,
      projectId,
      pdfData.monteurNaam,
      opts?.teamgenootId
    );
  } catch {
    /* best-effort */
  }

  // SIN + oplever-snapshot (zonder handtekening) op project zetten
  {
    const snapshot = snapshotOpleverFormulier(pdfData);
    const { error: sinUpdErr } = await sb
      .from("projecten")
      .update({ systeem_sin: sin, oplever_formulier: snapshot })
      .eq("id", projectId);
    if (
      sinUpdErr &&
      (sinUpdErr.code === "42703" ||
        sinUpdErr.message?.includes("oplever_formulier"))
    ) {
      const { error: fallbackErr } = await sb
        .from("projecten")
        .update({ systeem_sin: sin })
        .eq("id", projectId);
      if (
        fallbackErr &&
        !(
          fallbackErr.code === "42703" ||
          fallbackErr.message?.includes("systeem_sin")
        )
      ) {
        console.error("systeem_sin update:", fallbackErr.message);
      }
    } else if (
      sinUpdErr &&
      !(
        sinUpdErr.code === "42703" ||
        sinUpdErr.message?.includes("systeem_sin")
      )
    ) {
      console.error("systeem_sin update:", sinUpdErr.message);
    }

    const opmerking = snapshot.opmerkingen;
    if (opmerking) {
      const { data: row } = await sb
        .from("projecten")
        .select("installatie_notities")
        .eq("id", projectId)
        .maybeSingle();
      const existing = String(
        (row as { installatie_notities?: string | null } | null)
          ?.installatie_notities || ""
      ).trim();
      if (!existing.includes(opmerking)) {
        const next = existing
          ? `${existing}\n\nOplever: ${opmerking}`
          : `Oplever: ${opmerking}`;
        const { error: noteErr } = await sb
          .from("projecten")
          .update({ installatie_notities: next })
          .eq("id", projectId);
        if (noteErr) {
          console.error("oplever notitie:", noteErr.message);
        }
      }
    }
  }

  // Snapshot staat al op het project → After sale, ook als de PDF-upload hapert.
  await maybeAdvanceProjectNaOplevering(sb, projectId);

  const blob = await buildOpleverFormulierPdf(pdfData);
  const filename = `opleverformulier-${(data.projectNummer || projectId).replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf`;
  const file = new File([blob], filename, { type: "application/pdf" });

  const result = await uploadProjectFotoFile(
    sb,
    projectId,
    file,
    OPLEVERINGSRAPPORT_OMSCHRIJVING,
    { allowPdf: true }
  );
  const statusAdvance = await maybeAdvanceProjectNaOplevering(sb, projectId);
  if ("error" in result) return result;

  let projectAfter = statusAdvance?.project || null;
  if (data.vervolgNodig) {
    const booked = await bookServiceVvVanOplever(sb, projectId, data);
    if (booked.project) projectAfter = booked.project;
  }

  return {
    foto: result.foto,
    status_advance: statusAdvance,
    project: projectAfter,
  };
}

async function bookServiceVvVanOplever(
  sb: SupabaseClient,
  projectId: string,
  data: OpleverFormulierData
): Promise<{ project?: Record<string, unknown> | null }> {
  const rawAt = data.vervolgAt.trim();
  const asIso = rawAt.includes("T") && !rawAt.endsWith("Z") && !rawAt.includes("+")
    ? rawAt.length === 16
      ? `${rawAt}:00`
      : rawAt
    : rawAt;
  const at = new Date(asIso);
  if (Number.isNaN(at.getTime())) {
    console.error("oplever service_at ongeldig:", rawAt);
    return {};
  }

  const { data: project } = await sb
    .from("projecten")
    .select("id, installatie_partner_id")
    .eq("id", projectId)
    .maybeSingle();
  const partnerId =
    (project as { installatie_partner_id?: string | null } | null)
      ?.installatie_partner_id || null;

  let tgId = data.vervolgMonteurId.trim() || null;
  let tgNaam = data.vervolgMonteurNaam.trim() || null;
  if (tgId && partnerId) {
    let tgQ = await sb
      .from("installatie_partner_teamgenoten")
      .select("id, naam, actief, kan_service")
      .eq("id", tgId)
      .eq("partner_id", partnerId)
      .maybeSingle();
    if (
      tgQ.error &&
      (tgQ.error.code === "42703" ||
        tgQ.error.message?.includes("kan_service"))
    ) {
      tgQ = await sb
        .from("installatie_partner_teamgenoten")
        .select("id, naam, actief")
        .eq("id", tgId)
        .eq("partner_id", partnerId)
        .maybeSingle();
    }
    const tg = tgQ.data as {
      id: string;
      naam: string;
      actief?: boolean | null;
      kan_service?: boolean | null;
    } | null;
    if (!tg || tg.actief === false) {
      console.error("oplever service: monteur niet gevonden");
      return {};
    }
    if ("kan_service" in (tg as object) && tg.kan_service !== true) {
      console.error("oplever service: geen Service-vinkje");
      return {};
    }
    tgId = tg.id;
    tgNaam = tg.naam;
  }

  const patch: Record<string, unknown> = {
    service_at: at.toISOString(),
    service_notities: formatServiceVvNotitie(data.vervolgActie),
  };
  if (tgNaam) patch.monteur = tgNaam;
  if (tgId) patch.service_teamgenoot_id = tgId;

  let { data: updated, error } = await sb
    .from("projecten")
    .update(patch)
    .eq("id", projectId)
    .select("*")
    .single();

  if (
    error &&
    (error.message?.includes("service_teamgenoot_id") ||
      error.code === "42703")
  ) {
    const fallback = { ...patch };
    delete fallback.service_teamgenoot_id;
    const retry = await sb
      .from("projecten")
      .update(fallback)
      .eq("id", projectId)
      .select("*")
      .single();
    updated = retry.data;
    error = retry.error;
  }

  if (error) {
    console.error("oplever service boeken:", error.message);
    return {};
  }

  try {
    const { syncAutoTakenVoorProject } = await import("@/lib/sync-auto-taken");
    await syncAutoTakenVoorProject(sb, projectId, "after_sale");
  } catch {
    /* best-effort */
  }

  return { project: updated };
}

/** Parse JSON-body → OpleverFormulierData. */
export function parseOpleverFormulierBody(
  body: unknown
): { data: OpleverFormulierData } | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Ongeldige body" };
  }
  const b = body as Record<string, unknown>;
  const form = (b.form ?? b) as Record<string, unknown>;
  if (!form || typeof form !== "object") {
    return { error: "form is verplicht" };
  }

  const str = (k: string) => String(form[k] ?? "").trim();
  const rawAf = form.afgevinkt;
  const afgevinkt = (
    Array.isArray(rawAf) ? rawAf.map((x) => String(x)) : []
  ).filter((id): id is OpleverPuntId => PUNT_IDS.has(id));

  const data: OpleverFormulierData = {
    klantNaam: str("klantNaam"),
    adres: str("adres"),
    datum: str("datum"),
    projectNummer: str("projectNummer"),
    monteurNaam: str("monteurNaam"),
    sin: normalizeSysteemSin(str("sin")),
    afgevinkt,
    akkoord: form.akkoord === true || form.akkoord === "true" || form.akkoord === 1,
    handtekeningDataUrl: str("handtekeningDataUrl"),
    opmerkingen: str("opmerkingen"),
    vervolgNodig:
      form.vervolgNodig === true ||
      form.vervolgNodig === "true" ||
      form.vervolgNodig === 1,
    vervolgActie: str("vervolgActie"),
    vervolgAt: str("vervolgAt"),
    vervolgMonteurId: str("vervolgMonteurId"),
    vervolgMonteurNaam: str("vervolgMonteurNaam"),
  };

  const invalid = validateOpleverFormulier(data);
  if (invalid) return { error: invalid };

  return { data };
}

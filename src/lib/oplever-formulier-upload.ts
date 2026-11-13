import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOpleverFormulierPdf } from "@/lib/pdf-oplever-formulier";
import { uploadProjectFotoFile } from "@/lib/project-fotos";
import { OPLEVERINGSRAPPORT_OMSCHRIJVING } from "@/lib/project-documenten";
import { maybeAdvanceProjectNaOplevering } from "@/lib/project-na-oplevering";
import {
  OPLEVER_PUNTEN,
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

  // SIN op project zetten (voor Alpha-portaal e.d.)
  {
    const { error: sinUpdErr } = await sb
      .from("projecten")
      .update({ systeem_sin: sin })
      .eq("id", projectId);
    if (
      sinUpdErr &&
      !(
        sinUpdErr.code === "42703" ||
        sinUpdErr.message?.includes("systeem_sin")
      )
    ) {
      console.error("systeem_sin update:", sinUpdErr.message);
    }
  }

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
  if ("error" in result) return result;

  const statusAdvance = await maybeAdvanceProjectNaOplevering(sb, projectId);

  return {
    foto: result.foto,
    status_advance: statusAdvance,
    project: statusAdvance?.project || null,
  };
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
  };

  const invalid = validateOpleverFormulier(data);
  if (invalid) return { error: invalid };

  return { data };
}

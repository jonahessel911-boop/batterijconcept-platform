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

const PUNT_IDS = new Set<string>(OPLEVER_PUNTEN.map((p) => p.id));

export async function generateAndUploadOpleverFormulier(
  sb: SupabaseClient,
  projectId: string,
  data: OpleverFormulierData
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

  const blob = await buildOpleverFormulierPdf(data);
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
    afgevinkt,
    akkoord: form.akkoord === true || form.akkoord === "true" || form.akkoord === 1,
    handtekeningDataUrl: str("handtekeningDataUrl"),
    opmerkingen: str("opmerkingen"),
  };

  const invalid = validateOpleverFormulier(data);
  if (invalid) return { error: invalid };

  return { data };
}

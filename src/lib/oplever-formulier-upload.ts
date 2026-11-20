import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOpleverFormulierPdf } from "@/lib/pdf-oplever-formulier";
import { uploadProjectFotoFile } from "@/lib/project-fotos";
import { OPLEVERINGSRAPPORT_OMSCHRIJVING } from "@/lib/project-documenten";
import { maybeAdvanceProjectNaOplevering } from "@/lib/project-na-oplevering";
import {
  OPLEVER_PUNTEN,
  snapshotOpleverFormulier,
  type OpleverFormulierData,
  type OpleverPuntId,
  validateOpleverFormulier,
} from "@/lib/oplever-formulier";
import { setServiceInkoopRegels } from "@/lib/project-inkoop-checklist";
import { ensureOpleverVervolgServiceVerzoek } from "@/lib/service-verzoek";
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
    const applied = await applyOpleverServiceInkoop(sb, projectId, data);
    if (applied.project) projectAfter = applied.project;
    const verzoek = await applyOpleverServiceVerzoek(sb, projectId, data);
    if (verzoek.project) projectAfter = verzoek.project;
  }

  return {
    foto: result.foto,
    status_advance: statusAdvance,
    project: projectAfter,
  };
}

async function applyOpleverServiceInkoop(
  sb: SupabaseClient,
  projectId: string,
  data: OpleverFormulierData
): Promise<{ project?: Record<string, unknown> | null }> {
  const { data: row, error: loadErr } = await sb
    .from("projecten")
    .select("id, materiaal_checks")
    .eq("id", projectId)
    .maybeSingle();
  if (loadErr || !row) {
    if (loadErr) console.error("oplever service inkoop load:", loadErr.message);
    return {};
  }
  const nextChecks = setServiceInkoopRegels(
    (row as { materiaal_checks?: Record<string, unknown> | null })
      .materiaal_checks as Parameters<typeof setServiceInkoopRegels>[0],
    (data.vervolgMaterialen || []).map((m, i) => ({
      id: m.id || `svc-${i + 1}`,
      label: m.label,
      aantal: m.aantal,
    }))
  );
  const { data: updated, error } = await sb
    .from("projecten")
    .update({ materiaal_checks: nextChecks })
    .eq("id", projectId)
    .select("*")
    .single();
  if (error) {
    console.error("oplever service inkoop:", error.message);
    return {};
  }
  return { project: updated };
}

function opleverVervolgOmschrijving(data: OpleverFormulierData): string {
  const regels: string[] = [
    "Restpunt na oplevering. Backoffice neemt contact op om een service-moment in te plannen.",
  ];
  const actie = data.vervolgActie.trim();
  if (actie) regels.push(actie);
  const mats = (data.vervolgMaterialen || []).filter((m) => m.label.trim());
  if (mats.length > 0) {
    regels.push(
      "In te kopen: " +
        mats.map((m) => `${m.aantal}× ${m.label.trim()}`).join(", ")
    );
  }
  return regels.join("\n\n");
}

async function applyOpleverServiceVerzoek(
  sb: SupabaseClient,
  projectId: string,
  data: OpleverFormulierData
): Promise<{ project?: Record<string, unknown> | null }> {
  const { data: row, error: loadErr } = await sb
    .from("projecten")
    .select("id, lead_id, oplever_formulier")
    .eq("id", projectId)
    .maybeSingle();
  if (loadErr || !row) {
    if (loadErr) console.error("oplever serviceverzoek load:", loadErr.message);
    return {};
  }

  const snap = (row as { oplever_formulier?: Record<string, unknown> | null })
    .oplever_formulier;
  const bestaandeId =
    (typeof snap?.vervolgServiceVerzoekId === "string" &&
      snap.vervolgServiceVerzoekId) ||
    data.vervolgServiceVerzoekId ||
    null;

  const verzoekId = await ensureOpleverVervolgServiceVerzoek(sb, {
    projectId,
    leadId: (row as { lead_id?: string }).lead_id,
    omschrijving: opleverVervolgOmschrijving(data),
    bestaandeId,
  });
  if (!verzoekId) return {};

  const nextSnap = {
    ...(snap && typeof snap === "object" ? snap : {}),
    vervolgNodig: true,
    vervolgActie: data.vervolgActie.trim(),
    vervolgServiceVerzoekId: verzoekId,
  };
  const { data: updated, error } = await sb
    .from("projecten")
    .update({ oplever_formulier: nextSnap })
    .eq("id", projectId)
    .select("*")
    .single();
  if (error) {
    console.error("oplever serviceverzoek snapshot:", error.message);
    return {};
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
    vervolgMaterialen: Array.isArray(form.vervolgMaterialen)
      ? form.vervolgMaterialen
          .map((row, i) => {
            const r =
              row && typeof row === "object"
                ? (row as Record<string, unknown>)
                : {};
            return {
              id: String(r.id ?? "").trim() || `svc-${i + 1}`,
              label: String(r.label ?? r.omschrijving ?? "").trim(),
              aantal: Math.max(1, Math.round(Number(r.aantal) || 1)),
            };
          })
          .filter((r) => r.label)
      : [],
    vervolgAt: str("vervolgAt"),
    vervolgMonteurId: str("vervolgMonteurId"),
    vervolgMonteurNaam: str("vervolgMonteurNaam"),
  };

  const invalid = validateOpleverFormulier(data);
  if (invalid) return { error: invalid };

  return { data };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSchouwFormulierPdf } from "@/lib/pdf-schouw-formulier";
import { uploadProjectFotoFile } from "@/lib/project-fotos";
import { SCHOUW_FORMULIER_OMSCHRIJVING } from "@/lib/project-documenten";
import { maybeAdvanceProjectNaSchouw } from "@/lib/project-na-schouw";
import type { SchouwFormulierData } from "@/lib/schouw-formulier";

export async function generateAndUploadSchouwFormulier(
  sb: SupabaseClient,
  projectId: string,
  data: SchouwFormulierData,
  opts?: { notitie?: string | null }
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
      status_advance: Awaited<ReturnType<typeof maybeAdvanceProjectNaSchouw>>;
      project?: Record<string, unknown> | null;
    }
  | { error: string; status: number; detail?: string }
> {
  const blob = await buildSchouwFormulierPdf(data);
  const filename = `schouwformulier-${(data.rapportNr || projectId).replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf`;
  const file = new File([blob], filename, { type: "application/pdf" });

  const result = await uploadProjectFotoFile(
    sb,
    projectId,
    file,
    SCHOUW_FORMULIER_OMSCHRIJVING,
    { allowPdf: true }
  );
  if ("error" in result) return result;

  const notitie = (opts?.notitie || "").trim();
  if (notitie) {
    await sb
      .from("projecten")
      .update({
        schouw_notities: notitie,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);
  }

  const statusAdvance = await maybeAdvanceProjectNaSchouw(sb, projectId);

  return {
    foto: result.foto,
    status_advance: statusAdvance,
    project: statusAdvance?.project || null,
  };
}

/** Rudimentaire validatie van JSON-body → SchouwFormulierData. */
export function parseSchouwFormulierBody(
  body: unknown
): { data: SchouwFormulierData; notitie: string | null } | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Ongeldige body" };
  }
  const b = body as Record<string, unknown>;
  const form = (b.form ?? b) as Record<string, unknown>;
  if (!form || typeof form !== "object") {
    return { error: "form is verplicht" };
  }

  const str = (k: string) => String(form[k] ?? "").trim();
  const mee = form.meeTeNemen;
  const meeTeNemen = Array.isArray(mee)
    ? mee.map((x) => String(x)).filter(Boolean)
    : [];

  const data: SchouwFormulierData = {
    klantNaam: str("klantNaam"),
    adres: str("adres"),
    telefoon: str("telefoon"),
    email: str("email"),
    datum: str("datum"),
    rapportNr: str("rapportNr"),
    opnemer: str("opnemer"),
    klusNr: str("klusNr"),
    modelOmvormer: str("modelOmvormer"),
    capaciteitKwh: str("capaciteitKwh"),
    aantalModules: str("aantalModules"),
    serienummers: str("serienummers"),
    typeAansluiting: str("typeAansluiting"),
    hoofdzekering: str("hoofdzekering"),
    vrijeGroepen: str("vrijeGroepen"),
    ruimteExtraGroep: str("ruimteExtraGroep"),
    aardlekTePlaatsen: str("aardlekTePlaatsen"),
    deugdelijkeAarding: str("deugdelijkeAarding") as SchouwFormulierData["deugdelijkeAarding"],
    ctKlemPlaatsbaar: str("ctKlemPlaatsbaar") as SchouwFormulierData["ctKlemPlaatsbaar"],
    fotoMeterkast: str("fotoMeterkast") as SchouwFormulierData["fotoMeterkast"],
    plekBatterij: str("plekBatterij"),
    binnenBuiten: str("binnenBuiten"),
    montagewijze: str("montagewijze"),
    wandtype: str("wandtype"),
    beschikbareRuimte: str("beschikbareRuimte"),
    vorstvrij: str("vorstvrij") as SchouwFormulierData["vorstvrij"],
    ventilatie: str("ventilatie") as SchouwFormulierData["ventilatie"],
    brandveiligeAfstand: str("brandveiligeAfstand") as SchouwFormulierData["brandveiligeAfstand"],
    afstandMeterkastM: str("afstandMeterkastM"),
    kabelroute: str("kabelroute"),
    doorMurenVloeren: str("doorMurenVloeren"),
    boormateriaal: str("boormateriaal"),
    aantalDoorvoeren: str("aantalDoorvoeren"),
    boordiameter: str("boordiameter"),
    kabelgootNodig: str("kabelgootNodig"),
    kabelgootLengteM: str("kabelgootLengteM"),
    kabeldoorsnede: str("kabeldoorsnede"),
    hakGraafwerk: str("hakGraafwerk"),
    wifiBereik: str("wifiBereik"),
    ladderNodig: str("ladderNodig"),
    aanvoerParkeren: str("aanvoerParkeren"),
    installatietijdDagdelen: str("installatietijdDagdelen"),
    meeTeNemen,
    meerwerkObstakels: str("meerwerkObstakels"),
    aanvullendeOpmerkingen: str("aanvullendeOpmerkingen"),
    handtekeningOpnemerNaam: str("handtekeningOpnemerNaam"),
    handtekeningKlantNaam: str("handtekeningKlantNaam"),
  };

  if (!data.klantNaam) return { error: "Klantnaam is verplicht" };

  const notitieRaw = b.notitie;
  const notitie =
    typeof notitieRaw === "string" && notitieRaw.trim()
      ? notitieRaw.trim()
      : data.aanvullendeOpmerkingen || data.meerwerkObstakels || null;

  return { data, notitie };
}

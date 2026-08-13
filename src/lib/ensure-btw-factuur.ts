import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Maakt een concept BTW-factuur bij een ondertekende offerte (idempotent).
 * Bedrag = BTW van de offerte. Wordt NIET naar de klant gestuurd.
 */
export async function ensureBtwDraftFactuur(
  sb: SupabaseClient,
  opts: {
    offerteId: string;
    leadId: string;
    projectId?: string | null;
    offerteNummer: string;
    btwBedrag: number;
    subtotaalExBtw?: number;
  }
): Promise<{ id: string; factuur_nummer: string; created: boolean } | null> {
  const { data: existing } = await sb
    .from("facturen")
    .select("id, factuur_nummer")
    .eq("offerte_id", opts.offerteId)
    .ilike("omschrijving", "BTW-factuur%")
    .maybeSingle();

  if (existing?.id) {
    return {
      id: existing.id,
      factuur_nummer: existing.factuur_nummer,
      created: false,
    };
  }

  // Fallback: any factuur for this offerte
  const { data: anyFac } = await sb
    .from("facturen")
    .select("id, factuur_nummer")
    .eq("offerte_id", opts.offerteId)
    .limit(1)
    .maybeSingle();

  if (anyFac?.id) {
    return {
      id: anyFac.id,
      factuur_nummer: anyFac.factuur_nummer,
      created: false,
    };
  }

  const { data: nummer, error: numErr } = await sb.rpc(
    "generate_factuur_nummer"
  );
  if (numErr || !nummer) {
    console.error("generate_factuur_nummer:", numErr);
    return null;
  }

  const btw = Math.round(Number(opts.btwBedrag) * 100) / 100;
  const today = new Date();
  const verval = new Date(today);
  verval.setDate(verval.getDate() + 14);

  const { data: created, error } = await sb
    .from("facturen")
    .insert({
      lead_id: opts.leadId,
      project_id: opts.projectId || null,
      offerte_id: opts.offerteId,
      factuur_nummer: nummer as string,
      status: "concept",
      omschrijving: `BTW-factuur bij ${opts.offerteNummer}`,
      // Factuur voor het BTW-bedrag: te betalen = BTW
      bedrag_ex_btw: 0,
      btw_bedrag: btw,
      bedrag_inc_btw: btw,
      factuurdatum: today.toISOString().slice(0, 10),
      vervaldatum: verval.toISOString().slice(0, 10),
      notities: `Concept (draft) — BTW over subtotaal excl. ${
        opts.subtotaalExBtw != null
          ? `€ ${Number(opts.subtotaalExBtw).toFixed(2).replace(".", ",")}`
          : "offerte"
      }. Controleer vóór verzending naar de klant.`,
    })
    .select("id, factuur_nummer")
    .single();

  if (error || !created) {
    console.error("BTW-factuur aanmaken:", error);
    return null;
  }

  return {
    id: created.id,
    factuur_nummer: created.factuur_nummer,
    created: true,
  };
}

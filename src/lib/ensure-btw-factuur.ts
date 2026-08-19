import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aanbetalingVanOrder,
  normalizeAanbetalingModus,
  type AanbetalingModus,
} from "@/lib/aanbetaling";
import { formatEuro } from "@/lib/format";

/**
 * Maakt een concept-aanbetalingsfactuur bij een ondertekende Warmtefonds-offerte.
 * Wordt NIET automatisch naar de klant gestuurd.
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
    totaalIncBtw?: number;
    financieringVoorbehoud?: boolean | null;
    aanbetalingModus?: AanbetalingModus | string | null;
    aanbetalingBedragInc?: number | null;
  }
): Promise<{ id: string; factuur_nummer: string; created: boolean } | null> {
  const aanbetaling = aanbetalingVanOrder({
    subtotaalExBtw: opts.subtotaalExBtw ?? 0,
    btwBedrag: opts.btwBedrag,
    totaalIncBtw: opts.totaalIncBtw,
    modus: normalizeAanbetalingModus(opts.aanbetalingModus),
    handmatigIncBtw: opts.aanbetalingBedragInc,
    financieringVoorbehoud: opts.financieringVoorbehoud,
  });

  if (aanbetaling.bedragIncBtw <= 0) {
    return null;
  }

  const omschrijving = `Aanbetaling bij ${opts.offerteNummer} (restant ${formatEuro(aanbetaling.restantIncBtw)})`;
  const today = new Date();
  const verval = new Date(today);
  verval.setDate(verval.getDate() + 7);
  const factuurdatum = today.toISOString().slice(0, 10);
  const vervaldatum = verval.toISOString().slice(0, 10);
  const notities = `Betreft offerte ${opts.offerteNummer}`;

  const amounts = {
    omschrijving,
    bedrag_ex_btw: aanbetaling.bedragExBtw,
    btw_bedrag: aanbetaling.btwBedrag,
    bedrag_inc_btw: aanbetaling.bedragIncBtw,
    notities,
  };

  const { data: existingList } = await sb
    .from("facturen")
    .select("id, factuur_nummer, status, omschrijving")
    .eq("offerte_id", opts.offerteId);

  const existing =
    (existingList || []).find((f) =>
      /aanbetaling|btw-factuur/i.test(f.omschrijving || "")
    ) || existingList?.[0];

  if (existing?.id) {
    if (existing.status === "concept") {
      await sb.from("facturen").update(amounts).eq("id", existing.id);
    }
    return {
      id: existing.id,
      factuur_nummer: existing.factuur_nummer,
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

  const { data: created, error } = await sb
    .from("facturen")
    .insert({
      lead_id: opts.leadId,
      project_id: opts.projectId || null,
      offerte_id: opts.offerteId,
      factuur_nummer: nummer as string,
      status: "concept",
      factuurdatum,
      vervaldatum,
      ...amounts,
    })
    .select("id, factuur_nummer")
    .single();

  if (error || !created) {
    console.error("Aanbetalingsfactuur aanmaken:", error);
    return null;
  }

  return {
    id: created.id,
    factuur_nummer: created.factuur_nummer,
    created: true,
  };
}

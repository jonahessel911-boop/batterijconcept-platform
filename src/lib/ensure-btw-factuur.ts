import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aanbetalingVanOrder,
  isAanbetalingFactuurOmschrijving,
  isRestantFactuurOmschrijving,
  normalizeAanbetalingModus,
  restantFactuurBedrag,
  splitIncToExBtw,
  type AanbetalingModus,
} from "@/lib/aanbetaling";
import { formatEuro } from "@/lib/format";
import {
  FACTUUR_BETAALTERMIJN_DAGEN,
  amsterdamDatePlusDays,
} from "@/lib/factuur-betaling";

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
  const factuurdatum = amsterdamDatePlusDays(today, 0);
  // Concept: nog geen harde termijn; bij versturen wordt 3 dagen gezet
  const vervaldatum = amsterdamDatePlusDays(today, FACTUUR_BETAALTERMIJN_DAGEN);
  const notities = `Betreft offerte ${opts.offerteNummer}. Betaal op NL48 BUNQ 2209 5579 33 t.n.v. BatterijConcept o.v.v. ${opts.offerteNummer}.`;

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
      isAanbetalingFactuurOmschrijving(f.omschrijving)
    ) ||
    (existingList || []).find((f) => !isRestantFactuurOmschrijving(f.omschrijving)) ||
    existingList?.[0];

  if (existing?.id) {
    // Alleen concept bijwerken — verzonden/betaalde facturen niet aanpassen
    if (existing.status === "concept") {
      await sb
        .from("facturen")
        .update({
          ...amounts,
          factuurdatum,
          vervaldatum,
        })
        .eq("id", existing.id);
      await sb
        .from("offertes")
        .update({ aanbetaling_te_innen_inc: aanbetaling.bedragIncBtw })
        .eq("id", opts.offerteId);
      if (opts.projectId) {
        await sb
          .from("projecten")
          .update({ aanbetaling_te_innen_inc: aanbetaling.bedragIncBtw })
          .eq("id", opts.projectId);
      } else {
        await sb
          .from("projecten")
          .update({ aanbetaling_te_innen_inc: aanbetaling.bedragIncBtw })
          .eq("offerte_id", opts.offerteId);
      }
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

  await sb
    .from("offertes")
    .update({ aanbetaling_te_innen_inc: aanbetaling.bedragIncBtw })
    .eq("id", opts.offerteId);
  if (opts.projectId) {
    await sb
      .from("projecten")
      .update({ aanbetaling_te_innen_inc: aanbetaling.bedragIncBtw })
      .eq("id", opts.projectId);
  } else {
    await sb
      .from("projecten")
      .update({ aanbetaling_te_innen_inc: aanbetaling.bedragIncBtw })
      .eq("offerte_id", opts.offerteId);
  }

  return {
    id: created.id,
    factuur_nummer: created.factuur_nummer,
    created: true,
  };
}

/**
 * Concept-restantfactuur.
 * Warmtefonds: Warmtefonds-deel (max € 8.500, nooit meer dan order excl. btw).
 * Anders: order incl. − reeds gefactureerd.
 */
export async function ensureRestantDraftFactuur(
  sb: SupabaseClient,
  opts: {
    offerteId: string;
    leadId: string;
    projectId?: string | null;
    offerteNummer: string;
    orderIncBtw: number;
    orderExBtw?: number | null;
    warmtefonds?: boolean;
  }
): Promise<{ id: string; factuur_nummer: string; created: boolean } | null> {
  const { data: existingList } = await sb
    .from("facturen")
    .select("id, factuur_nummer, status, omschrijving, bedrag_inc_btw")
    .eq("offerte_id", opts.offerteId);

  const facturen = existingList || [];
  const existingConcept = facturen.find(
    (f) =>
      isRestantFactuurOmschrijving(f.omschrijving) && f.status === "concept"
  );

  const bedragIncBtw = restantFactuurBedrag({
    orderIncBtw: opts.orderIncBtw,
    orderExBtw: opts.orderExBtw,
    warmtefonds: opts.warmtefonds,
    facturen,
    excludeRestant: Boolean(existingConcept),
  });

  if (bedragIncBtw < 0.01) {
    const anyRestant = facturen.find((f) =>
      isRestantFactuurOmschrijving(f.omschrijving)
    );
    if (anyRestant) {
      return {
        id: anyRestant.id,
        factuur_nummer: anyRestant.factuur_nummer,
        created: false,
      };
    }
    return null;
  }

  const split = splitIncToExBtw(bedragIncBtw);
  const label = opts.warmtefonds ? "Warmtefonds / restant" : "Restant";
  const omschrijving = `Restantfactuur bij ${opts.offerteNummer} (${label} ${formatEuro(bedragIncBtw)})`;
  const today = new Date();
  const factuurdatum = amsterdamDatePlusDays(today, 0);
  const vervaldatum = amsterdamDatePlusDays(today, FACTUUR_BETAALTERMIJN_DAGEN);
  const notities = `Betreft offerte ${opts.offerteNummer}. Betaal op NL48 BUNQ 2209 5579 33 t.n.v. BatterijConcept o.v.v. ${opts.offerteNummer}.`;

  const amounts = {
    omschrijving,
    bedrag_ex_btw: split.ex,
    btw_bedrag: split.btw,
    bedrag_inc_btw: split.inc,
    notities,
  };

  if (existingConcept?.id) {
    await sb
      .from("facturen")
      .update({
        ...amounts,
        factuurdatum,
        vervaldatum,
        ...(opts.projectId ? { project_id: opts.projectId } : {}),
      })
      .eq("id", existingConcept.id);
    return {
      id: existingConcept.id,
      factuur_nummer: existingConcept.factuur_nummer,
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
    console.error("Restantfactuur aanmaken:", error);
    return null;
  }

  return {
    id: created.id,
    factuur_nummer: created.factuur_nummer,
    created: true,
  };
}

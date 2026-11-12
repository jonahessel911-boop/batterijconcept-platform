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
import {
  eindafrekeningBedrag,
  isEindafrekeningFactuurOmschrijving,
  isProjectOpgeleverd,
} from "@/lib/eindafrekening";
import {
  factuurOmschrijvingMetProduct,
  primaireProductOmschrijving,
} from "@/lib/factuur-omschrijving";
import { formatEuro } from "@/lib/format";
import {
  COMPANY_IBAN_DISPLAY,
  FACTUUR_BETAALTERMIJN_DAGEN,
  FACTUUR_BETAALTERMIJN_WARMTEFONDS_RESTANT_DAGEN,
  amsterdamDatePlusDays,
} from "@/lib/factuur-betaling";

async function productLabelVoorOfferte(
  sb: SupabaseClient,
  offerteId: string
): Promise<string | null> {
  const { data } = await sb
    .from("offerte_regels")
    .select("omschrijving, product_id, prijs_ex_btw, sort_order")
    .eq("offerte_id", offerteId)
    .order("sort_order", { ascending: true });
  return primaireProductOmschrijving(data || []);
}

/** Verwijder openstaande concept-aanbetalingsfacturen (bijv. bij €0 aanbetaling). */
async function removeConceptAanbetalingFacturen(
  sb: SupabaseClient,
  offerteId: string
): Promise<void> {
  const { data: existingList } = await sb
    .from("facturen")
    .select("id, status, omschrijving")
    .eq("offerte_id", offerteId);
  const toRemove = (existingList || []).filter(
    (f) =>
      f.status === "concept" &&
      // Eindafrekening staat los van de aanbetaling — nooit meeruimen
      !isEindafrekeningFactuurOmschrijving(f.omschrijving) &&
      (isAanbetalingFactuurOmschrijving(f.omschrijving) ||
        !isRestantFactuurOmschrijving(f.omschrijving))
  );
  for (const f of toRemove) {
    await sb.from("facturen").delete().eq("id", f.id);
  }
}

async function setAanbetalingTeInnen(
  sb: SupabaseClient,
  opts: { offerteId: string; projectId?: string | null; bedrag: number }
): Promise<void> {
  await sb
    .from("offertes")
    .update({ aanbetaling_te_innen_inc: opts.bedrag })
    .eq("id", opts.offerteId);
  if (opts.projectId) {
    await sb
      .from("projecten")
      .update({ aanbetaling_te_innen_inc: opts.bedrag })
      .eq("id", opts.projectId);
  } else {
    await sb
      .from("projecten")
      .update({ aanbetaling_te_innen_inc: opts.bedrag })
      .eq("offerte_id", opts.offerteId);
  }
}

/**
 * Maakt/werkt een concept-aanbetalingsfactuur bij.
 * Alleen aanroepen ná doorzetten naar backoffice (“Actie afronden”),
 * met de definitieve aanbetaling — niet bij ondertekenen.
 * Wordt NIET automatisch naar de klant gestuurd.
 *
 * Handmatig / te_innen €0 (WF én EM): géén factuur aanmaken;
 * bestaande concept-aanbetalingsfacturen worden verwijderd.
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
    /** Definitief bedrag na doorzetten — €0 = geen factuur. */
    aanbetalingTeInnenInc?: number | null;
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

  // Doorgezet bedrag wint (handmatig €0 → te_innen 0 → geen factuur)
  let bedragIncBtw = aanbetaling.bedragIncBtw;
  if (
    opts.aanbetalingTeInnenInc != null &&
    Number.isFinite(Number(opts.aanbetalingTeInnenInc))
  ) {
    bedragIncBtw = Math.round(Number(opts.aanbetalingTeInnenInc) * 100) / 100;
  }
  // Expliciet handmatig €0
  if (
    normalizeAanbetalingModus(opts.aanbetalingModus) === "handmatig" &&
    opts.aanbetalingBedragInc != null &&
    Number(opts.aanbetalingBedragInc) <= 0
  ) {
    bedragIncBtw = 0;
  }

  if (bedragIncBtw <= 0) {
    await removeConceptAanbetalingFacturen(sb, opts.offerteId);
    await setAanbetalingTeInnen(sb, {
      offerteId: opts.offerteId,
      projectId: opts.projectId,
      bedrag: 0,
    });
    return null;
  }

  const split = splitIncToExBtw(bedragIncBtw);
  const restantIncBtw = Math.round(
    (Math.max(0, (Number(opts.totaalIncBtw) || aanbetaling.orderIncBtw) - bedragIncBtw)) *
      100
  ) / 100;

  const product = await productLabelVoorOfferte(sb, opts.offerteId);
  const omschrijving = factuurOmschrijvingMetProduct(
    product,
    `Aanbetaling bij ${opts.offerteNummer} (restant ${formatEuro(restantIncBtw)})`
  );
  const today = new Date();
  const factuurdatum = amsterdamDatePlusDays(today, 0);
  // Concept: nog geen harde termijn; bij versturen wordt 3 dagen gezet
  const vervaldatum = amsterdamDatePlusDays(today, FACTUUR_BETAALTERMIJN_DAGEN);
  const notities = `Betreft offerte ${opts.offerteNummer}. Betaal op ${COMPANY_IBAN_DISPLAY} t.n.v. BatterijConcept o.v.v. ${opts.offerteNummer}.`;

  const amounts = {
    omschrijving,
    bedrag_ex_btw: split.ex,
    btw_bedrag: split.btw,
    bedrag_inc_btw: split.inc,
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
      await setAanbetalingTeInnen(sb, {
        offerteId: opts.offerteId,
        projectId: opts.projectId,
        bedrag: bedragIncBtw,
      });
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

  await setAanbetalingTeInnen(sb, {
    offerteId: opts.offerteId,
    projectId: opts.projectId,
    bedrag: bedragIncBtw,
  });

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
  const product = await productLabelVoorOfferte(sb, opts.offerteId);
  // Product verplicht + restbetaling/offerte — geen bedragen in de omschrijving
  const omschrijving = factuurOmschrijvingMetProduct(
    product,
    `Restbetaling bij ${opts.offerteNummer}`
  );
  const today = new Date();
  const factuurdatum = amsterdamDatePlusDays(today, 0);
  const betaaltermijnDagen = opts.warmtefonds
    ? FACTUUR_BETAALTERMIJN_WARMTEFONDS_RESTANT_DAGEN
    : FACTUUR_BETAALTERMIJN_DAGEN;
  const vervaldatum = amsterdamDatePlusDays(today, betaaltermijnDagen);
  const notities = `Betreft offerte ${opts.offerteNummer}. Betaal op ${COMPANY_IBAN_DISPLAY} t.n.v. BatterijConcept o.v.v. ${opts.offerteNummer}.`;

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

export type EindafrekeningResultaat = {
  id: string;
  factuur_nummer: string;
  created: boolean;
  bedrag_inc_btw: number;
};

/**
 * Concept-eindafrekening: het deel van de order dat na oplevering op geen
 * enkele factuur staat. Typisch het stuk boven het Warmtefonds-plafond van
 * € 8.500, of de hele order als er geen aanbetaling was.
 *
 * Wordt NOOIT naar de klant gestuurd — dat blijft een losse handeling.
 * Idempotent: bestaand concept wordt bijgewerkt, verzonden/betaalde facturen
 * blijven ongemoeid.
 */
export async function ensureEindafrekeningDraftFactuur(
  sb: SupabaseClient,
  opts: {
    offerteId: string;
    leadId: string;
    projectId?: string | null;
    offerteNummer: string;
    orderIncBtw: number;
  }
): Promise<EindafrekeningResultaat | null> {
  const { data: existingList } = await sb
    .from("facturen")
    .select(
      "id, factuur_nummer, status, omschrijving, bedrag_inc_btw, credit_van_factuur_id"
    )
    .eq("offerte_id", opts.offerteId);

  const facturen = existingList || [];
  const existingConcept = facturen.find(
    (f) =>
      isEindafrekeningFactuurOmschrijving(f.omschrijving) &&
      f.status === "concept"
  );

  const bedragIncBtw = eindafrekeningBedrag({
    orderIncBtw: opts.orderIncBtw,
    facturen,
    excludeEindafrekening: Boolean(existingConcept),
  });

  if (bedragIncBtw <= 0) {
    // Order is inmiddels volledig gefactureerd (bijv. handmatige factuur
    // toegevoegd of orderbedrag aangepast) — concept opruimen.
    if (existingConcept?.id) {
      await sb.from("facturen").delete().eq("id", existingConcept.id);
    }
    return null;
  }

  const split = splitIncToExBtw(bedragIncBtw);
  const product = await productLabelVoorOfferte(sb, opts.offerteId);
  const omschrijving = factuurOmschrijvingMetProduct(
    product,
    `Eindafrekening bij ${opts.offerteNummer}`
  );
  const today = new Date();
  const factuurdatum = amsterdamDatePlusDays(today, 0);
  const vervaldatum = amsterdamDatePlusDays(today, FACTUUR_BETAALTERMIJN_DAGEN);
  const notities = `Betreft offerte ${opts.offerteNummer}. Betaal op ${COMPANY_IBAN_DISPLAY} t.n.v. BatterijConcept o.v.v. ${opts.offerteNummer}.`;

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
      bedrag_inc_btw: split.inc,
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
    console.error("Eindafrekening aanmaken:", error);
    return null;
  }

  return {
    id: created.id,
    factuur_nummer: created.factuur_nummer,
    created: true,
    bedrag_inc_btw: split.inc,
  };
}

export type EindafrekeningProjectResultaat = {
  ok: boolean;
  skipped?: string;
  factuur?: EindafrekeningResultaat | null;
  project_nummer?: string | null;
  bedrag_inc_btw?: number;
};

/**
 * Projectvariant: laadt order + offerte en zet de concept-eindafrekening klaar.
 * Alleen voor opgeleverde projecten. Gebruikt na oplevering en door de cron.
 */
export async function ensureEindafrekeningVoorProject(
  sb: SupabaseClient,
  projectId: string,
  opts?: { dryRun?: boolean }
): Promise<EindafrekeningProjectResultaat> {
  const { data: project, error } = await sb
    .from("projecten")
    .select(
      "id, lead_id, offerte_id, project_nummer, status, offertes(id, offerte_nummer, totaal_inc_btw)"
    )
    .eq("id", projectId)
    .maybeSingle();

  if (error || !project) {
    return { ok: false, skipped: "project niet gevonden" };
  }
  if (!isProjectOpgeleverd(project.status as string | null)) {
    return { ok: true, skipped: "niet opgeleverd" };
  }

  const offerte = Array.isArray(project.offertes)
    ? project.offertes[0]
    : project.offertes;
  const offerteId =
    (offerte as { id?: string } | null)?.id ||
    (project.offerte_id as string | null);
  const orderIncBtw =
    Number(
      (offerte as { totaal_inc_btw?: number | null } | null)?.totaal_inc_btw
    ) || 0;

  if (!offerteId || !project.lead_id) {
    return { ok: true, skipped: "geen offerte gekoppeld" };
  }
  if (orderIncBtw <= 0) {
    return { ok: true, skipped: "geen orderbedrag" };
  }

  if (opts?.dryRun) {
    const { data: facturen } = await sb
      .from("facturen")
      .select("status, omschrijving, bedrag_inc_btw, credit_van_factuur_id")
      .eq("offerte_id", offerteId);
    const bedrag = eindafrekeningBedrag({
      orderIncBtw,
      facturen: facturen || [],
      excludeEindafrekening: true,
    });
    return {
      ok: true,
      project_nummer: project.project_nummer as string | null,
      bedrag_inc_btw: bedrag,
      factuur: null,
      ...(bedrag <= 0 ? { skipped: "niets te factureren" } : {}),
    };
  }

  const factuur = await ensureEindafrekeningDraftFactuur(sb, {
    offerteId,
    leadId: project.lead_id as string,
    projectId: project.id as string,
    offerteNummer:
      (offerte as { offerte_nummer?: string } | null)?.offerte_nummer ||
      (project.project_nummer as string) ||
      "order",
    orderIncBtw,
  });

  return {
    ok: true,
    factuur,
    project_nummer: project.project_nummer as string | null,
    bedrag_inc_btw: factuur?.bedrag_inc_btw ?? 0,
    ...(factuur ? {} : { skipped: "niets te factureren" }),
  };
}

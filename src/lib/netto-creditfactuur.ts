import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NETTO_AANBETALING_COMMISSIE,
  isAanbetalingFactuur,
  nextWednesdayYmd,
} from "@/lib/netto-boord";
import { creditWeekFromDate } from "@/lib/adviseur-creditfactuur";

/**
 * Maak (of hergebruik) een creditfactuur van €250 voor de verkoper
 * zodra een aanbetalingsfactuur op betaald staat.
 * Betaal-/factuurdatum = eerstvolgende woensdag.
 */
export async function ensureNettoAanbetalingCreditfactuur(
  sb: SupabaseClient,
  factuurId: string
): Promise<{
  ok: boolean;
  created?: boolean;
  creditfactuur_id?: string;
  skipped?: string;
  error?: string;
}> {
  const { data: fac, error: facErr } = await sb
    .from("facturen")
    .select(
      "id, factuur_nummer, lead_id, status, omschrijving, betaald_op, offerte_id"
    )
    .eq("id", factuurId)
    .maybeSingle();

  if (facErr || !fac) {
    return { ok: false, error: facErr?.message || "Factuur niet gevonden" };
  }
  if (fac.status !== "betaald") {
    return { ok: true, skipped: "niet_betaald" };
  }
  if (!isAanbetalingFactuur(fac.omschrijving)) {
    return { ok: true, skipped: "geen_aanbetaling" };
  }
  if (!fac.lead_id) {
    return { ok: true, skipped: "geen_lead" };
  }

  const { data: existingRegel } = await sb
    .from("adviseur_creditfactuur_regels")
    .select("id, creditfactuur_id")
    .eq("factuur_id", factuurId)
    .maybeSingle();

  if (existingRegel?.creditfactuur_id) {
    return {
      ok: true,
      created: false,
      creditfactuur_id: existingRegel.creditfactuur_id as string,
      skipped: "al_gekoppeld",
    };
  }

  const { data: lead } = await sb
    .from("leads")
    .select("id, naam, adviseur_id")
    .eq("id", fac.lead_id)
    .maybeSingle();

  if (!lead?.adviseur_id) {
    return { ok: true, skipped: "geen_adviseur" };
  }

  const { data: adv } = await sb
    .from("adviseurs")
    .select(
      "id, naam, bedrijfsnaam, kvk_nummer, iban, max_factuur_bedrag, actief"
    )
    .eq("id", lead.adviseur_id)
    .maybeSingle();

  if (!adv) return { ok: true, skipped: "adviseur_ontbreekt" };
  if (!adv.bedrijfsnaam || !adv.kvk_nummer || !adv.iban) {
    return { ok: true, skipped: "zzp_gegevens_incompleet" };
  }

  const betaaldag = nextWednesdayYmd(
    fac.betaald_op ? new Date(fac.betaald_op) : new Date()
  );
  const weekInfo = creditWeekFromDate(
    fac.betaald_op ? new Date(fac.betaald_op) : new Date()
  );

  let fee = NETTO_AANBETALING_COMMISSIE;
  const max =
    adv.max_factuur_bedrag != null && Number(adv.max_factuur_bedrag) > 0
      ? Number(adv.max_factuur_bedrag)
      : null;
  if (max != null && fee > max) fee = max;

  // Uniek nummer
  const { count } = await sb
    .from("adviseur_creditfacturen")
    .select("id", { count: "exact", head: true })
    .eq("week_jaar", weekInfo.jaar)
    .eq("week_nummer", weekInfo.week);
  const seq = String((count || 0) + 1).padStart(3, "0");
  const factuurNummer = `CF-${weekInfo.jaar}-W${String(weekInfo.week).padStart(2, "0")}-${seq}`;

  // Als er al een open CF voor deze week bestaat: regel toevoegen en bedrag ophogen
  const { data: weekCf } = await sb
    .from("adviseur_creditfacturen")
    .select("id, bedrag_ex_btw, bedrag_inc_btw, status, aantal_aanbetalingen")
    .eq("adviseur_id", adv.id)
    .eq("week_jaar", weekInfo.jaar)
    .eq("week_nummer", weekInfo.week)
    .neq("status", "geannuleerd")
    .maybeSingle();

  let creditId: string;

  if (weekCf?.id) {
    creditId = weekCf.id as string;
    const nextCount = Number(weekCf.aantal_aanbetalingen || 0) + 1;
    const nextBedrag =
      Math.round((Number(weekCf.bedrag_ex_btw || 0) + fee) * 100) / 100;
    await sb
      .from("adviseur_creditfacturen")
      .update({
        aantal_aanbetalingen: nextCount,
        bedrag_ex_btw: nextBedrag,
        btw_bedrag: 0,
        bedrag_inc_btw: nextBedrag,
        factuurdatum: betaaldag,
        notities: `Netto-boord: uitbetaling woensdag ${betaaldag}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", creditId);
  } else {
    const { data: created, error: createErr } = await sb
      .from("adviseur_creditfacturen")
      .insert({
        adviseur_id: adv.id,
        factuur_nummer: factuurNummer,
        status: "concept",
        week_jaar: weekInfo.jaar,
        week_nummer: weekInfo.week,
        periode_van: weekInfo.van,
        periode_tot: weekInfo.tot,
        aantal_aanbetalingen: 1,
        bedrag_ex_btw: fee,
        btw_bedrag: 0,
        bedrag_inc_btw: fee,
        factuurdatum: betaaldag,
        notities: `Netto-boord: eerste commissie €${fee} · uitbetaling woensdag ${betaaldag}`,
      })
      .select("id")
      .single();

    if (createErr || !created) {
      // Race op unique week → opnieuw proberen als regel
      if (createErr?.code === "23505") {
        const { data: again } = await sb
          .from("adviseur_creditfacturen")
          .select("id")
          .eq("adviseur_id", adv.id)
          .eq("week_jaar", weekInfo.jaar)
          .eq("week_nummer", weekInfo.week)
          .neq("status", "geannuleerd")
          .maybeSingle();
        if (!again) {
          return { ok: false, error: createErr.message };
        }
        creditId = again.id as string;
      } else {
        return { ok: false, error: createErr?.message || "CF aanmaken mislukt" };
      }
    } else {
      creditId = created.id as string;
    }
  }

  const { data: off } = fac.offerte_id
    ? await sb
        .from("offertes")
        .select("offerte_nummer")
        .eq("id", fac.offerte_id)
        .maybeSingle()
    : { data: null };

  const { error: regelErr } = await sb.from("adviseur_creditfactuur_regels").insert({
    creditfactuur_id: creditId,
    factuur_id: fac.id,
    lead_id: fac.lead_id,
    bedrag: fee,
    omschrijving: [
      "Tranche A · aanbetaling",
      lead.naam,
      off?.offerte_nummer ? `offerte ${off.offerte_nummer}` : null,
      fac.factuur_nummer ? `factuur ${fac.factuur_nummer}` : null,
      fac.betaald_op ? `betaald ${fac.betaald_op}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  });

  if (regelErr) {
    if (regelErr.code === "23505") {
      return { ok: true, created: false, creditfactuur_id: creditId, skipped: "regel_bestaat" };
    }
    return { ok: false, error: regelErr.message };
  }

  return { ok: true, created: true, creditfactuur_id: creditId };
}

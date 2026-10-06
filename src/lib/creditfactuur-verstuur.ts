import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAdviseurCreditPdfBytes } from "@/lib/adviseur-creditfactuur-pdf-data";
import { buildPartnerCreditfactuurPdf } from "@/lib/pdf-partner-creditfactuur";
import { normalizeRelatieFactuurBedragen } from "@/lib/pdf-relatie-factuur";
import { mailRelatieFactuur } from "@/lib/relatie-factuur-mail";

/** Verstuur selfbilling-factuur naar adviseur → status verzonden. */
export async function verstuurAdviseurCreditfactuur(
  sb: SupabaseClient,
  id: string
): Promise<
  | { ok: true; factuur: Record<string, unknown>; mail_sent: boolean; mail_error?: string }
  | { ok: false; error: string; status: number }
> {
  const { data: fac, error } = await sb
    .from("adviseur_creditfacturen")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !fac) {
    return { ok: false, error: "Factuur niet gevonden", status: 404 };
  }
  if (fac.status === "geannuleerd") {
    return { ok: false, error: "Geannuleerde factuur kan niet verstuurd", status: 400 };
  }
  if (fac.status === "goedgekeurd" || fac.status === "betaald") {
    return { ok: false, error: "Factuur is al goedgekeurd", status: 400 };
  }

  const { data: adv } = await sb
    .from("adviseurs")
    .select(
      "id, naam, email, bedrijfsnaam, kvk_nummer, btw_nummer, iban, factuur_adres, factuur_postcode, factuur_plaats"
    )
    .eq("id", fac.adviseur_id)
    .maybeSingle();
  if (!adv) {
    return { ok: false, error: "Adviseur niet gevonden", status: 404 };
  }
  if (!adv.email?.trim()) {
    return { ok: false, error: "Adviseur heeft geen e-mailadres", status: 400 };
  }
  if (!adv.bedrijfsnaam || !adv.kvk_nummer || !adv.iban) {
    return {
      ok: false,
      error: "Vul eerst KvK-gegevens in bij de adviseur",
      status: 400,
    };
  }

  const amounts = normalizeRelatieFactuurBedragen(fac);
  if (
    Number(fac.btw_bedrag || 0) !== 0 ||
    Number(fac.bedrag_inc_btw || 0) !== amounts.bedrag_inc_btw
  ) {
    await sb
      .from("adviseur_creditfacturen")
      .update(amounts)
      .eq("id", id);
    Object.assign(fac, amounts);
  }

  const pdfBytes = await buildAdviseurCreditPdfBytes(sb, fac, adv);
  const mail = await mailRelatieFactuur({
    to: adv.email,
    naam: adv.naam,
    factuurNummer: fac.factuur_nummer,
    bedragInc: amounts.bedrag_inc_btw,
    factuurdatum: fac.factuurdatum,
    iban: adv.iban,
    rolLabel: "adviseur",
    pdfBytes,
  });

  if (!mail.ok) {
    return {
      ok: false,
      error: mail.error || "Mail versturen mislukt",
      status: 500,
    };
  }

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await sb
    .from("adviseur_creditfacturen")
    .update({
      status: "verzonden",
      verzonden_op: fac.verzonden_op || now,
      ...amounts,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (updErr || !updated) {
    return {
      ok: false,
      error: updErr?.message || "Status bijwerken mislukt",
      status: 500,
    };
  }

  return { ok: true, factuur: updated, mail_sent: true };
}

/** Verstuur selfbilling-factuur naar installatiepartner → status verzonden. */
export async function verstuurPartnerCreditfactuur(
  sb: SupabaseClient,
  id: string
): Promise<
  | { ok: true; factuur: Record<string, unknown>; mail_sent: boolean }
  | { ok: false; error: string; status: number }
> {
  const { data: fac, error } = await sb
    .from("partner_creditfacturen")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !fac) {
    return { ok: false, error: "Factuur niet gevonden", status: 404 };
  }
  if (fac.status === "geannuleerd") {
    return { ok: false, error: "Geannuleerde factuur kan niet verstuurd", status: 400 };
  }
  if (fac.status === "goedgekeurd" || fac.status === "betaald") {
    return { ok: false, error: "Factuur is al goedgekeurd", status: 400 };
  }

  const { data: partner } = await sb
    .from("installatie_partners")
    .select(
      "id, naam, email, bedrijfsnaam, kvk_nummer, btw_nummer, iban, factuur_adres, factuur_postcode, factuur_plaats"
    )
    .eq("id", fac.partner_id)
    .maybeSingle();
  if (!partner) {
    return { ok: false, error: "Partner niet gevonden", status: 404 };
  }
  if (!partner.email?.trim()) {
    return { ok: false, error: "Partner heeft geen e-mailadres", status: 400 };
  }
  if (!partner.bedrijfsnaam || !partner.kvk_nummer || !partner.iban) {
    return {
      ok: false,
      error: "Vul eerst KvK-gegevens in bij de partner",
      status: 400,
    };
  }

  const amounts = normalizeRelatieFactuurBedragen(fac);
  Object.assign(fac, amounts);

  const blob = await buildPartnerCreditfactuurPdf({
    factuur: {
      factuur_nummer: fac.factuur_nummer,
      factuurdatum: fac.factuurdatum,
      status: fac.status,
      week_jaar: fac.week_jaar,
      week_nummer: fac.week_nummer,
      periode_van: fac.periode_van,
      periode_tot: fac.periode_tot,
      bedrag_ex_btw: amounts.bedrag_ex_btw,
      bedrag_inc_btw: amounts.bedrag_inc_btw,
      btw_bedrag: amounts.btw_bedrag,
      omschrijving: fac.omschrijving,
      notities: fac.notities,
      offerte_nummer: fac.offerte_nummer,
      project_nummer: fac.project_nummer,
    },
    partner: {
      naam: partner.naam,
      email: partner.email,
      bedrijfsnaam: partner.bedrijfsnaam,
      kvk_nummer: partner.kvk_nummer,
      btw_nummer: partner.btw_nummer,
      iban: partner.iban,
      factuur_adres: partner.factuur_adres,
      factuur_postcode: partner.factuur_postcode,
      factuur_plaats: partner.factuur_plaats,
    },
  });
  const pdfBytes = Buffer.from(await blob.arrayBuffer());
  const mail = await mailRelatieFactuur({
    to: partner.email,
    naam: partner.naam,
    factuurNummer: fac.factuur_nummer,
    bedragInc: amounts.bedrag_inc_btw,
    factuurdatum: fac.factuurdatum,
    iban: partner.iban,
    rolLabel: "installatiepartner",
    pdfBytes,
  });

  if (!mail.ok) {
    return {
      ok: false,
      error: mail.error || "Mail versturen mislukt",
      status: 500,
    };
  }

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await sb
    .from("partner_creditfacturen")
    .update({
      status: "verzonden",
      ...amounts,
      verzonden_op: fac.verzonden_op || now,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (updErr || !updated) {
    return {
      ok: false,
      error: updErr?.message || "Status bijwerken mislukt",
      status: 500,
    };
  }

  return { ok: true, factuur: updated, mail_sent: true };
}

/** Mail PDF na goedkeuring naar de ingestelde e-mail van de adviseur. */
export async function mailGoedgekeurdeAdviseurCreditfactuur(
  sb: SupabaseClient,
  id: string
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const { data: fac } = await sb
    .from("adviseur_creditfacturen")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!fac) return { ok: false, error: "Factuur niet gevonden" };

  const { data: adv } = await sb
    .from("adviseurs")
    .select(
      "id, naam, email, bedrijfsnaam, kvk_nummer, btw_nummer, iban, factuur_adres, factuur_postcode, factuur_plaats"
    )
    .eq("id", fac.adviseur_id)
    .maybeSingle();
  if (!adv) return { ok: false, error: "Adviseur niet gevonden" };
  if (!adv.email?.trim()) {
    return { ok: false, skipped: true, error: "Geen e-mailadres" };
  }

  const amounts = normalizeRelatieFactuurBedragen(fac);
  if (Number(fac.btw_bedrag || 0) !== 0) {
    await sb.from("adviseur_creditfacturen").update(amounts).eq("id", id);
    Object.assign(fac, amounts);
  }
  const pdfBytes = await buildAdviseurCreditPdfBytes(sb, fac, adv);
  return mailRelatieFactuur({
    to: adv.email,
    naam: adv.naam,
    factuurNummer: fac.factuur_nummer,
    bedragInc: amounts.bedrag_inc_btw,
    factuurdatum: fac.factuurdatum,
    iban: adv.iban,
    rolLabel: "adviseur",
    pdfBytes,
    variant: "goedgekeurd",
  });
}

/** Mail PDF na goedkeuring naar de ingestelde e-mail van de partner. */
export async function mailGoedgekeurdePartnerCreditfactuur(
  sb: SupabaseClient,
  id: string
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const { data: fac } = await sb
    .from("partner_creditfacturen")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!fac) return { ok: false, error: "Factuur niet gevonden" };

  const { data: partner } = await sb
    .from("installatie_partners")
    .select(
      "id, naam, email, bedrijfsnaam, kvk_nummer, btw_nummer, iban, factuur_adres, factuur_postcode, factuur_plaats"
    )
    .eq("id", fac.partner_id)
    .maybeSingle();
  if (!partner) return { ok: false, error: "Partner niet gevonden" };
  if (!partner.email?.trim()) {
    return { ok: false, skipped: true, error: "Geen e-mailadres" };
  }

  const amounts = normalizeRelatieFactuurBedragen(fac);
  if (Number(fac.btw_bedrag || 0) !== 0) {
    await sb.from("partner_creditfacturen").update(amounts).eq("id", id);
  }
  const blob = await buildPartnerCreditfactuurPdf({
    factuur: {
      factuur_nummer: fac.factuur_nummer,
      factuurdatum: fac.factuurdatum,
      status: fac.status,
      week_jaar: fac.week_jaar,
      week_nummer: fac.week_nummer,
      periode_van: fac.periode_van,
      periode_tot: fac.periode_tot,
      bedrag_ex_btw: amounts.bedrag_ex_btw,
      bedrag_inc_btw: amounts.bedrag_inc_btw,
      btw_bedrag: amounts.btw_bedrag,
      omschrijving: fac.omschrijving,
      notities: fac.notities,
      offerte_nummer: fac.offerte_nummer,
      project_nummer: fac.project_nummer,
    },
    partner: {
      naam: partner.naam,
      email: partner.email,
      bedrijfsnaam: partner.bedrijfsnaam,
      kvk_nummer: partner.kvk_nummer,
      btw_nummer: partner.btw_nummer,
      iban: partner.iban,
      factuur_adres: partner.factuur_adres,
      factuur_postcode: partner.factuur_postcode,
      factuur_plaats: partner.factuur_plaats,
    },
  });
  const pdfBytes = Buffer.from(await blob.arrayBuffer());
  return mailRelatieFactuur({
    to: partner.email,
    naam: partner.naam,
    factuurNummer: fac.factuur_nummer,
    bedragInc: amounts.bedrag_inc_btw,
    factuurdatum: fac.factuurdatum,
    iban: partner.iban,
    rolLabel: "installatiepartner",
    pdfBytes,
    variant: "goedgekeurd",
  });
}

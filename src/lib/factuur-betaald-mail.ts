/**
 * Bedankmail naar klant wanneer een (niet-credit) factuur βetaald wordt.
 * Gebruikt door handmatige PATCH én bunq auto-match.
 * WF-declaratie krijgt een eigen mail, afhankelijk van of het schouwformulier er is.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, appBaseUrl } from "@/lib/email/postmark";
import {
  factuurBetaaldEmail,
  wfDeclaratieBetaaldEmail,
} from "@/lib/email/templates";
import { formatEuro } from "@/lib/format";
import { ensureOfferteTrackToken } from "@/lib/ensure-track-token";
import { logLeadEvent } from "@/lib/lead-events";
import {
  isWarmtefondsFactuurContext,
  resolveFactuurSoort,
} from "@/lib/factuur-soort";
import { isSchouwFormulierBewijs } from "@/lib/project-documenten";
import type { Betaalwijze } from "@/types/database";

type Sb = SupabaseClient;

async function schouwFormulierUploadAt(
  sb: Sb,
  projectId: string | null | undefined
): Promise<string | null> {
  if (!projectId) return null;
  const { data: fotos } = await sb
    .from("project_fotos")
    .select("omschrijving, bestandsnaam, storage_path, created_at")
    .eq("project_id", projectId);
  const hits = (fotos || []).filter((f) =>
    isSchouwFormulierBewijs(f.omschrijving, f.bestandsnaam, f.storage_path)
  );
  if (hits.length === 0) return null;
  hits.sort((a, b) =>
    String(a.created_at || "").localeCompare(String(b.created_at || ""))
  );
  return (hits[0]?.created_at as string | null) || null;
}

export async function notifyKlantFactuurBetaald(
  sb: Sb,
  factuurId: string
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const { data: fac, error } = await sb
    .from("facturen")
    .select(
      "id, factuur_nummer, bedrag_inc_btw, lead_id, project_id, offerte_id, credit_van_factuur_id, omschrijving, leads(naam, email, status)"
    )
    .eq("id", factuurId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!fac) return { ok: false, skipped: "factuur niet gevonden" };

  if (fac.credit_van_factuur_id) {
    return { ok: false, skipped: "creditfactuur" };
  }

  const lead = fac.leads as
    | { naam?: string | null; email?: string | null; status?: string | null }
    | { naam?: string | null; email?: string | null; status?: string | null }[]
    | null;
  const leadRow = Array.isArray(lead) ? lead[0] : lead;
  const email = leadRow?.email?.trim() || "";
  if (!email) return { ok: false, skipped: "geen e-mailadres" };

  const naam = leadRow?.naam?.trim() || "klant";
  const nr = (fac.factuur_nummer as string) || factuurId.slice(0, 8);
  const bedrag = formatEuro(Number(fac.bedrag_inc_btw) || 0);

  let trackUrl: string | null = null;
  let projectId = (fac.project_id as string | null) || null;
  let financieringVoorbehoud: boolean | null = null;
  let projectBetaalwijze: Betaalwijze | null = null;

  try {
    let offerteId = (fac.offerte_id as string | null) || null;
    if (projectId) {
      const { data: proj } = await sb
        .from("projecten")
        .select("offerte_id, betaalwijze, offertes(financiering_voorbehoud)")
        .eq("id", projectId)
        .maybeSingle();
      offerteId = offerteId || (proj?.offerte_id as string | null) || null;
      projectBetaalwijze = (proj?.betaalwijze as Betaalwijze | null) || null;
      const off = proj?.offertes as
        | { financiering_voorbehoud?: boolean | null }
        | { financiering_voorbehoud?: boolean | null }[]
        | null
        | undefined;
      const offRow = Array.isArray(off) ? off[0] : off;
      financieringVoorbehoud = offRow?.financiering_voorbehoud ?? null;
    }
    if (offerteId) {
      const { data: offTrack } = await sb
        .from("offertes")
        .select("id, track_token, financiering_voorbehoud")
        .eq("id", offerteId)
        .maybeSingle();
      if (offTrack?.id) {
        if (financieringVoorbehoud == null) {
          financieringVoorbehoud =
            (offTrack.financiering_voorbehoud as boolean | null) ?? null;
        }
        const token = await ensureOfferteTrackToken(
          sb,
          offTrack.id,
          offTrack.track_token
        );
        if (token) trackUrl = `${appBaseUrl()}/track/${token}`;
      }
    }
  } catch {
    /* track optioneel */
  }

  const isWarmtefonds = isWarmtefondsFactuurContext({
    project: {
      betaalwijze: projectBetaalwijze,
      leads: { status: leadRow?.status ?? null },
    },
    financieringVoorbehoud,
  });
  const soort = resolveFactuurSoort(
    { omschrijving: fac.omschrijving as string | null, credit_van_factuur_id: null },
    { isWarmtefonds }
  );
  const isWfDeclaratie = soort === "wf_declaratie";

  const schouwFormulierAt = isWfDeclaratie
    ? await schouwFormulierUploadAt(sb, projectId)
    : null;

  const html = isWfDeclaratie
    ? wfDeclaratieBetaaldEmail({
        naam,
        factuurNummer: nr,
        bedrag,
        trackUrl,
        schouwFormulierGeuploadAt: schouwFormulierAt,
      })
    : factuurBetaaldEmail({
        naam,
        factuurNummer: nr,
        bedrag,
        trackUrl,
      });

  const subject = isWfDeclaratie
    ? `Warmtefonds-declaratie betaald — factuur ${nr}`
    : `Bedankt voor je betaling — factuur ${nr}`;
  const tag = isWfDeclaratie ? "wf-declaratie-betaald" : "factuur-betaald";

  const sent = await sendEmail({
    to: email,
    subject,
    html,
    tag,
  });

  if (!sent.ok) {
    return { ok: false, error: sent.error || "mail mislukt" };
  }

  if (fac.lead_id) {
    try {
      await logLeadEvent({
        leadId: fac.lead_id as string,
        soort: "email",
        titel: isWfDeclaratie
          ? `WF-declaratie betaald mail ${nr} verstuurd`
          : `Bedankmail betaling ${nr} verstuurd`,
        detail: email,
        meta: {
          factuur_id: factuurId,
          factuur_nummer: nr,
          tag,
          message_id: sent.messageId || null,
          schouw_formulier_geupload: Boolean(schouwFormulierAt),
        },
      });
    } catch {
      /* best-effort */
    }
  }

  return { ok: true };
}

/**
 * Bedankmail naar klant wanneer een (niet-credit) factuur βetaald wordt.
 * Gebruikt door handmatige PATCH én bunq auto-match.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, appBaseUrl } from "@/lib/email/postmark";
import { factuurBetaaldEmail } from "@/lib/email/templates";
import { formatEuro } from "@/lib/format";
import { ensureOfferteTrackToken } from "@/lib/ensure-track-token";
import { logLeadEvent } from "@/lib/lead-events";

type Sb = SupabaseClient;

export async function notifyKlantFactuurBetaald(
  sb: Sb,
  factuurId: string
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const { data: fac, error } = await sb
    .from("facturen")
    .select(
      "id, factuur_nummer, bedrag_inc_btw, lead_id, project_id, offerte_id, credit_van_factuur_id, omschrijving, leads(naam, email)"
    )
    .eq("id", factuurId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!fac) return { ok: false, skipped: "factuur niet gevonden" };

  if (fac.credit_van_factuur_id) {
    return { ok: false, skipped: "creditfactuur" };
  }

  const lead = fac.leads as
    | { naam?: string | null; email?: string | null }
    | { naam?: string | null; email?: string | null }[]
    | null;
  const leadRow = Array.isArray(lead) ? lead[0] : lead;
  const email = leadRow?.email?.trim() || "";
  if (!email) return { ok: false, skipped: "geen e-mailadres" };

  const naam = leadRow?.naam?.trim() || "klant";
  const nr = (fac.factuur_nummer as string) || factuurId.slice(0, 8);
  const bedrag = formatEuro(Number(fac.bedrag_inc_btw) || 0);

  let trackUrl: string | null = null;
  try {
    let offerteId = (fac.offerte_id as string | null) || null;
    if (!offerteId && fac.project_id) {
      const { data: proj } = await sb
        .from("projecten")
        .select("offerte_id")
        .eq("id", fac.project_id)
        .maybeSingle();
      offerteId = (proj?.offerte_id as string | null) || null;
    }
    if (offerteId) {
      const { data: offTrack } = await sb
        .from("offertes")
        .select("id, track_token")
        .eq("id", offerteId)
        .maybeSingle();
      if (offTrack?.id) {
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

  const html = factuurBetaaldEmail({
    naam,
    factuurNummer: nr,
    bedrag,
    trackUrl,
  });

  const sent = await sendEmail({
    to: email,
    subject: `Bedankt voor je betaling — factuur ${nr}`,
    html,
    tag: "factuur-betaald",
  });

  if (!sent.ok) {
    return { ok: false, error: sent.error || "mail mislukt" };
  }

  if (fac.lead_id) {
    try {
      await logLeadEvent({
        leadId: fac.lead_id as string,
        soort: "email",
        titel: `Bedankmail betaling ${nr} verstuurd`,
        detail: email,
        meta: {
          factuur_id: factuurId,
          factuur_nummer: nr,
          tag: "factuur-betaald",
          message_id: sent.messageId || null,
        },
      });
    } catch {
      /* best-effort */
    }
  }

  return { ok: true };
}

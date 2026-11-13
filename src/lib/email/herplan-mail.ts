import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email/postmark";
import { replyToForLeadAdviseur } from "@/lib/email/adviseur-reply-to";
import { herplanAankondigingEmail } from "@/lib/email/templates";
import { logLeadEvent } from "@/lib/lead-events";

/**
 * Mail + belpogingen-reset wanneer een lead in de herplan-wachtrij komt.
 * Idempotent genoeg: bij al-herplan-status zonder reset mag caller overslaan.
 */
export async function verstuurHerplanAankondigingMail(
  sb: SupabaseClient,
  lead: { id: string; naam?: string | null; email?: string | null }
): Promise<{ ok: boolean; skipped?: boolean; reason?: string }> {
  const email = (lead.email || "").trim();
  if (!email) return { ok: false, skipped: true, reason: "geen_email" };

  const subject =
    "We bellen u voor het herplannen van uw afspraak — Batterijconcept";
  const html = herplanAankondigingEmail({ naam: lead.naam || "klant" });
  const result = await sendEmail({
    to: email,
    subject,
    html,
    tag: "lead-herplan-aankondiging",
    replyTo: await replyToForLeadAdviseur(sb, lead.id),
  });

  if (!result.ok) {
    return { ok: false, reason: result.error || "Mail versturen mislukt" };
  }

  await logLeadEvent({
    leadId: lead.id,
    soort: "contact",
    titel: "Herplan-aankondiging mail verstuurd",
    detail: subject,
    meta: {
      tag: "lead-herplan-aankondiging",
      messageId: result.messageId || null,
    },
  });

  return { ok: true };
}

/** Zet lead op herplan, reset belpogingen, stuur aankondigingsmail. */
export async function activeerHerplanVoorBellen(
  sb: SupabaseClient,
  leadId: string
): Promise<void> {
  const { data: lead } = await sb
    .from("leads")
    .select("id, naam, email, status, belpogingen")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return;

  const protectedStatus = new Set([
    "deal",
    "sale_financiering",
    "sale_eigen_middelen",
    "geen_interesse",
    "geen_interesse_al_batterij",
    "geen_interesse_plugin",
    "geen_interesse_alleen_info",
    "offerte_afgewezen",
    "niet_gekwalificeerd",
    "definitief_geen_contact",
  ]);
  if (protectedStatus.has(lead.status)) return;

  const alreadyHerplan = lead.status === "afspraak_afgezegd_klant";
  if (alreadyHerplan) return;

  const patch = {
    status: "afspraak_afgezegd_klant" as const,
    belpogingen: 0,
    belpogingen_vandaag: 0,
    terugbellen: false,
    terugbel_notitie: null,
  };

  let upd = await sb.from("leads").update(patch).eq("id", leadId);
  if (
    upd.error &&
    (upd.error.code === "42703" ||
      upd.error.message?.includes("terugbel") ||
      upd.error.message?.includes("belpogingen"))
  ) {
    await sb
      .from("leads")
      .update({ status: "afspraak_afgezegd_klant" })
      .eq("id", leadId);
  }

  try {
    await verstuurHerplanAankondigingMail(sb, lead);
  } catch {
    /* non-blocking */
  }
}

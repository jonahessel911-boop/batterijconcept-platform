import type { SupabaseClient } from "@supabase/supabase-js";
import { replyToForAfspraak } from "@/lib/email/adviseur-reply-to";
import {
  afspraakAvondVoorafEmailV2,
  afspraakAvondVoorafSmsV2,
  afspraakReminder48uEmailV2,
  afspraakReminder48uSmsV2,
  afspraakSocialProofEmailV2,
} from "@/lib/email/afspraak-sequence-v2";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { sendSms } from "@/lib/sms/bird";
import {
  shouldSendAvondSmsNow,
  shouldSendReminder48uNow,
  shouldSendSocialProofNow,
} from "./timing";
import { buildOpvolgingVars } from "./vars";

type LeadRow = {
  naam?: string | null;
  email?: string | null;
  telefoon?: string | null;
  postcode?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  straat?: string | null;
  plaats?: string | null;
};

export type AbAfspraakRow = {
  id: string;
  lead_id?: string | null;
  adviseur_id?: string | null;
  start_at: string;
  created_at: string;
  manage_token: string | null;
  opvolging_flow: "intensief" | "rustig";
  bevestiging_verstuurd: boolean;
  bevestiging_sms_verstuurd?: boolean;
  social_proof_verstuurd?: boolean;
  reminder_48u_verstuurd?: boolean;
  avond_sms_verstuurd?: boolean;
  avond_mail_verstuurd?: boolean;
  leads?: LeadRow | LeadRow[] | null;
  adviseurs?:
    | { naam?: string | null; email?: string | null }
    | { naam?: string | null; email?: string | null }[]
    | null;
};

/**
 * Cron-stappen voor intensief / rustig (niet legacy).
 * Bevestiging catch-up gebeurt apart via sendOpvolgingBevestiging.
 */
export async function processAbFollowups(
  sb: SupabaseClient,
  rows: AbAfspraakRow[],
  now: Date
): Promise<{
  social_proof: number;
  reminder_48u: number;
  reminder_48u_sms: number;
  avond_mail: number;
  avond_sms: number;
}> {
  let social_proof = 0;
  let reminder_48u = 0;
  let reminder_48u_sms = 0;
  let avond_mail = 0;
  let avond_sms = 0;

  for (const a of rows) {
    if (!a.manage_token) continue;
    const lead = Array.isArray(a.leads) ? a.leads[0] : a.leads;
    const adviseur = Array.isArray(a.adviseurs) ? a.adviseurs[0] : a.adviseurs;
    const email = lead?.email?.trim();
    const telefoon = lead?.telefoon?.trim();
    const startAt = new Date(a.start_at);
    const createdAt = new Date(a.created_at);
    const manageUrl = `${appBaseUrl()}/afspraak/${a.manage_token}`;
    const { v2 } = buildOpvolgingVars({
      naam: lead?.naam || "klant",
      startAt,
      adviseurNaam: adviseur?.naam || "Batterijconcept",
      manageToken: a.manage_token,
      manageUrl,
      lead,
    });
    const replyTo = await replyToForAfspraak(sb, {
      adviseurId: a.adviseur_id,
      leadId: a.lead_id,
      adviseurJoin: adviseur,
    });

    // Intensief: social proof
    if (
      a.opvolging_flow === "intensief" &&
      email &&
      shouldSendSocialProofNow({
        now,
        createdAt,
        startAt,
        bevestigingSent: Boolean(a.bevestiging_verstuurd),
        alreadySent: Boolean(a.social_proof_verstuurd),
      })
    ) {
      const result = await sendEmail({
        to: email,
        subject: "Je afspraak staat klaar — Batterijconcept",
        html: afspraakSocialProofEmailV2(v2),
        tag: "afspraak-social-proof",
        replyTo,
      });
      if (result.ok) {
        await sb
          .from("afspraken")
          .update({ social_proof_verstuurd: true })
          .eq("id", a.id);
        a.social_proof_verstuurd = true;
        social_proof += 1;
      }
    }

    // Intensief: 48u mail + SMS
    if (
      a.opvolging_flow === "intensief" &&
      shouldSendReminder48uNow({
        now,
        startAt,
        bevestigingSent: Boolean(a.bevestiging_verstuurd),
        alreadySent: Boolean(a.reminder_48u_verstuurd),
      })
    ) {
      let mailDone = false;
      if (email) {
        const result = await sendEmail({
          to: email,
          subject: "Over 2 dagen komt onze adviseur langs — Batterijconcept",
          html: afspraakReminder48uEmailV2(v2),
          tag: "afspraak-reminder-48u",
          replyTo,
        });
        mailDone = result.ok;
        if (result.ok) reminder_48u += 1;
      }
      let smsDone = !telefoon;
      if (telefoon) {
        const result = await sendSms({
          to: telefoon,
          body: afspraakReminder48uSmsV2(v2),
          tag: "afspraak-reminder-48u-sms",
        });
        smsDone = result.ok;
        if (result.ok) reminder_48u_sms += 1;
      }
      // Markeer als verstuurd als mail ok (SMS mag later opnieuw via missing flag — we zetten één flag)
      if (mailDone || smsDone) {
        await sb
          .from("afspraken")
          .update({ reminder_48u_verstuurd: true })
          .eq("id", a.id);
        a.reminder_48u_verstuurd = true;
      }
    }

    // Avond vóór: intensief = mail+SMS, rustig = alleen SMS
    const avondWindow = shouldSendAvondSmsNow({
      now,
      startAt,
      alreadySent: false,
    });
    if (avondWindow) {
      if (
        a.opvolging_flow === "intensief" &&
        !a.avond_mail_verstuurd &&
        email
      ) {
        const result = await sendEmail({
          to: email,
          subject: "Morgen komt onze adviseur langs — Batterijconcept",
          html: afspraakAvondVoorafEmailV2(v2),
          tag: "afspraak-avond-mail",
          replyTo,
        });
        if (result.ok) {
          await sb
            .from("afspraken")
            .update({ avond_mail_verstuurd: true })
            .eq("id", a.id);
          a.avond_mail_verstuurd = true;
          avond_mail += 1;
        }
      }

      if (!a.avond_sms_verstuurd && telefoon) {
        const result = await sendSms({
          to: telefoon,
          body: afspraakAvondVoorafSmsV2(v2),
          tag: `afspraak-avond-sms-${a.opvolging_flow}`,
        });
        if (result.ok) {
          await sb
            .from("afspraken")
            .update({ avond_sms_verstuurd: true })
            .eq("id", a.id);
          a.avond_sms_verstuurd = true;
          avond_sms += 1;
        }
      }
    }
  }

  return { social_proof, reminder_48u, reminder_48u_sms, avond_mail, avond_sms };
}

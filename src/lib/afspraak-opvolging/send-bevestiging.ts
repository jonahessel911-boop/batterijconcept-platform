import type { SupabaseClient } from "@supabase/supabase-js";
import { replyToForAfspraak } from "@/lib/email/adviseur-reply-to";
import {
  afspraakBevestigingSequenceEmail,
} from "@/lib/email/afspraak-sequence";
import {
  afspraakBevestigingSequenceEmailV2,
  afspraakBevestigingSmsV2,
} from "@/lib/email/afspraak-sequence-v2";
import { withEmailIconAttachments } from "@/lib/email/email-icon-attachments";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { sendSms } from "@/lib/sms/bird";
import { isAbOpvolgingFlow } from "./assign";
import { buildOpvolgingVars } from "./vars";
import type { OpvolgingFlow } from "./types";

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

/**
 * Bevestiging direct na inplannen — flow-aware.
 * Zelfde moment als voorheen: in afterCreate van planAfspraak (+ cron catch-up).
 */
export async function sendOpvolgingBevestiging(opts: {
  sb: SupabaseClient;
  afspraakId: string;
  flow: OpvolgingFlow | string | null | undefined;
  leadId?: string | null;
  adviseurId?: string | null;
  manageToken: string;
  startAt: Date;
  lead?: LeadRow | null;
  adviseur?: { naam?: string | null; email?: string | null } | null;
  alreadyMailSent?: boolean;
  alreadySmsSent?: boolean;
}): Promise<{
  mailOk: boolean;
  smsOk: boolean;
  mailError: string | null;
  smsError: string | null;
}> {
  const flow = opts.flow ?? "legacy";
  const email = opts.lead?.email?.trim() || null;
  const telefoon = opts.lead?.telefoon?.trim() || null;
  const manageUrl = `${appBaseUrl()}/afspraak/${opts.manageToken}`;
  const { v1, v2 } = buildOpvolgingVars({
    naam: opts.lead?.naam || "klant",
    startAt: opts.startAt,
    adviseurNaam: opts.adviseur?.naam || "Batterijconcept",
    manageToken: opts.manageToken,
    manageUrl,
    lead: opts.lead,
  });

  const replyTo = await replyToForAfspraak(opts.sb, {
    adviseurId: opts.adviseurId,
    leadId: opts.leadId,
    adviseurJoin: opts.adviseur,
  });

  let mailOk = Boolean(opts.alreadyMailSent);
  let smsOk = Boolean(opts.alreadySmsSent);
  let mailError: string | null = null;
  let smsError: string | null = null;

  if (isAbOpvolgingFlow(flow)) {
    if (!opts.alreadyMailSent) {
      if (!email) {
        mailError = "Lead heeft geen e-mailadres";
      } else {
        const html = afspraakBevestigingSequenceEmailV2(v2);
        const sent = await sendEmail({
          to: email,
          subject: "Afspraak bevestigd — Batterijconcept",
          html,
          tag: `afspraak-bevestiging-${flow}`,
          replyTo,
          attachments: withEmailIconAttachments(html),
        });
        if (sent.ok) {
          mailOk = true;
          await opts.sb
            .from("afspraken")
            .update({ bevestiging_verstuurd: true })
            .eq("id", opts.afspraakId);
        } else {
          mailError = sent.error || "Mail versturen mislukt";
        }
      }
    }

    if (!opts.alreadySmsSent) {
      if (!telefoon) {
        smsError = "Lead heeft geen telefoonnummer";
      } else {
        const sent = await sendSms({
          to: telefoon,
          body: afspraakBevestigingSmsV2(v2),
          tag: `afspraak-bevestiging-sms-${flow}`,
        });
        if (sent.ok) {
          smsOk = true;
          await opts.sb
            .from("afspraken")
            .update({ bevestiging_sms_verstuurd: true })
            .eq("id", opts.afspraakId);
        } else {
          smsError = sent.error || "SMS versturen mislukt";
        }
      }
    }
  } else {
    // Legacy v1 — alleen mail
    if (!opts.alreadyMailSent) {
      if (!email) {
        mailError = "Lead heeft geen e-mailadres";
      } else {
        const sent = await sendEmail({
          to: email,
          subject: "Afspraak bevestigd — Batterijconcept",
          html: afspraakBevestigingSequenceEmail(v1),
          tag: "afspraak-bevestiging",
          replyTo,
        });
        if (sent.ok) {
          mailOk = true;
          await opts.sb
            .from("afspraken")
            .update({ bevestiging_verstuurd: true })
            .eq("id", opts.afspraakId);
        } else {
          mailError = sent.error || "Mail versturen mislukt";
        }
      }
    }
  }

  return { mailOk, smsOk, mailError, smsError };
}

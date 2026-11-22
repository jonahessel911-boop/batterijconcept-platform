import {
  afspraakAvondVoorafEmailV2,
  afspraakAvondVoorafSmsV2,
  afspraakBevestigingSequenceEmailV2,
  afspraakBevestigingSmsV2,
  afspraakReminder48uEmailV2,
  afspraakReminder48uSmsV2,
  afspraakSocialProofEmailV2,
  type AfspraakMailVarsV2,
} from "@/lib/email/afspraak-sequence-v2";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { sendSms } from "@/lib/sms/bird";
import {
  TEST_FLOW_STEPS,
  type TestFlowId,
  type TestFlowStepId,
} from "./test-flow-defs";

export type { TestFlowId, TestFlowStepId } from "./test-flow-defs";
export { TEST_FLOW_STEPS } from "./test-flow-defs";

function sampleVars(voornaam: string): AfspraakMailVarsV2 {
  const base = appBaseUrl();
  return {
    voornaam: voornaam.trim() || "Test",
    afspraakDatum: "dinsdag 17 november 2026",
    afspraakTijd: "14:00",
    adres: "Voorbeeldstraat 12, 1234 AB Amsterdam",
    adviseurNaam: "Piet Jansen",
    manageUrl: `${base}/email-preview`,
    calendarUrl: `${base}/email-preview/agenda`,
    regioLabel: "jouw regio",
    regioAantalGeholpen: 180,
    regioGemiddeldeBesparingEuro: 90,
  };
}

export async function sendTestFlowStep(opts: {
  flow: TestFlowId;
  stepId: TestFlowStepId;
  email: string | null;
  telefoon: string | null;
  voornaam?: string | null;
}): Promise<{
  ok: boolean;
  mailOk: boolean | null;
  smsOk: boolean | null;
  mailError: string | null;
  smsError: string | null;
  label: string;
}> {
  const steps = TEST_FLOW_STEPS[opts.flow];
  const step = steps.find((s) => s.id === opts.stepId);
  if (!step) {
    return {
      ok: false,
      mailOk: null,
      smsOk: null,
      mailError: "Onbekende stap",
      smsError: null,
      label: opts.stepId,
    };
  }

  const v = sampleVars(opts.voornaam || "Test");
  let mailOk: boolean | null = null;
  let smsOk: boolean | null = null;
  let mailError: string | null = null;
  let smsError: string | null = null;

  if (step.hasMail) {
    if (!opts.email) {
      mailOk = false;
      mailError = "Geen e-mailadres";
    } else {
      const built = buildStepContent(opts.stepId, v);
      if (!built?.html || !built.subject) {
        mailOk = false;
        mailError = "Geen mail voor deze stap";
      } else {
        const sent = await sendEmail({
          to: opts.email,
          subject: `[TEST ${opts.flow}] ${built.subject}`,
          html: built.html,
          tag: `test-flow-${opts.flow}-${opts.stepId}`,
        });
        mailOk = sent.ok;
        mailError = sent.ok ? null : sent.error || "Mail mislukt";
      }
    }
  }

  if (step.hasSms) {
    if (!opts.telefoon) {
      smsOk = false;
      smsError = "Geen telefoonnummer";
    } else {
      const built = buildStepContent(opts.stepId, v);
      if (!built?.sms) {
        smsOk = false;
        smsError = "Geen SMS voor deze stap";
      } else {
        const sent = await sendSms({
          to: opts.telefoon,
          body: built.sms,
          tag: `test-flow-${opts.flow}-${opts.stepId}-sms`,
        });
        smsOk = sent.ok;
        smsError = sent.ok ? null : sent.error || "SMS mislukt";
      }
    }
  }

  const neededMail = step.hasMail;
  const neededSms = step.hasSms;
  const ok =
    (!neededMail || mailOk === true) && (!neededSms || smsOk === true);

  return {
    ok,
    mailOk,
    smsOk,
    mailError,
    smsError,
    label: step.label,
  };
}

function buildStepContent(
  stepId: TestFlowStepId,
  v: AfspraakMailVarsV2
): { subject?: string; html?: string; sms?: string } | null {
  switch (stepId) {
    case "bevestiging":
      return {
        subject: "Afspraak bevestigd — Batterijconcept",
        html: afspraakBevestigingSequenceEmailV2(v),
        sms: afspraakBevestigingSmsV2(v),
      };
    case "social-proof":
      return {
        subject: "Je afspraak staat klaar — Batterijconcept",
        html: afspraakSocialProofEmailV2(v),
      };
    case "reminder-48u":
      return {
        subject: "Over 2 dagen komt onze adviseur langs — Batterijconcept",
        html: afspraakReminder48uEmailV2(v),
        sms: afspraakReminder48uSmsV2(v),
      };
    case "avond-vooraf":
      return {
        subject: "Morgen komt onze adviseur langs — Batterijconcept",
        html: afspraakAvondVoorafEmailV2(v),
        sms: afspraakAvondVoorafSmsV2(v),
      };
    default:
      return null;
  }
}

import {
  afspraakBevestigingSequenceEmail,
  afspraakOpwarmSalderingEmail,
  afspraakReminder24uEmail,
  type AfspraakMailVars,
} from "@/lib/email/afspraak-sequence";
import {
  afspraakAvondVoorafEmailV2,
  afspraakAvondVoorafSmsV2,
  afspraakBevestigingSequenceEmailV2,
  afspraakBevestigingSmsV2,
  afspraakReminder48uEmailV2,
  afspraakReminder48uSmsV2,
  afspraakSocialProofEmailV2,
} from "@/lib/email/afspraak-sequence-v2";
import { rewriteEmailIconCidsForPreview } from "@/lib/email/email-icons";
import { appBaseUrl } from "@/lib/email/postmark";
import { EmailPreviewClient } from "./EmailPreviewClient";

const PREVIEW_CALENDAR_URL = `${appBaseUrl()}/email-preview/agenda`;
const previewHtml = (html: string) =>
  rewriteEmailIconCidsForPreview(html, appBaseUrl());

const SAMPLE: AfspraakMailVars = {
  voornaam: "Jan",
  afspraakDatum: "dinsdag 17 november 2026",
  afspraakTijd: "14:00",
  adres: "Voorbeeldstraat 12, 1234 AB Amsterdam",
  adviseurNaam: "Piet Jansen",
  manageUrl: "https://app.batterijconcept.nl/afspraak/voorbeeld-token",
};

const SAMPLE_V2 = {
  ...SAMPLE,
  calendarUrl: PREVIEW_CALENDAR_URL,
  regioLabel: "jouw regio",
  regioAantalGeholpen: 180,
  regioGemiddeldeBesparingEuro: 90,
};

const LEGACY_MAILS = [
  {
    id: "bevestiging",
    label: "Bevestiging",
    when: "Direct na inplannen",
    subject: "Afspraak bevestigd — Batterijconcept",
    html: afspraakBevestigingSequenceEmail(SAMPLE),
  },
  {
    id: "opwarm",
    label: "Opwarm saldering",
    when: "~48 uur vóór de afspraak",
    subject: "Salderingsregeling stopt in 2027 — Batterijconcept",
    html: afspraakOpwarmSalderingEmail(SAMPLE),
  },
  {
    id: "herinnering",
    label: "Herinnering 24u",
    when: "~24 uur vóór de afspraak",
    subject: "Morgen je adviesafspraak — Batterijconcept",
    html: afspraakReminder24uEmail(SAMPLE),
  },
];

const INTENSIEF_MAILS = [
  {
    id: "bevestiging",
    label: "Bevestiging",
    timing: "Direct na inplannen",
    when: "Direct na inplannen — mail + SMS tegelijk",
    subject: "Afspraak bevestigd — Batterijconcept",
    html: previewHtml(afspraakBevestigingSequenceEmailV2(SAMPLE_V2)),
    sms: {
      label: "SMS (tegelijk met mail)",
      body: afspraakBevestigingSmsV2(SAMPLE_V2),
    },
  },
  {
    id: "social-proof",
    label: "Social proof",
    timing: "Dag 3 (bij genoeg leadtime)",
    when:
      "Eerste warmhoud-mail met social proof. Standaard 3 dagen na inplannen, alleen als er genoeg leadtime is.",
    subject: "Je afspraak staat klaar — Batterijconcept",
    html: previewHtml(afspraakSocialProofEmailV2(SAMPLE_V2)),
    rules: [
      {
        leadtime: "≥ 7 dagen",
        action: "Versturen op dag 3 na inplannen",
      },
      {
        leadtime: "≤ 4 dagen",
        action: "Niet versturen → direct door naar 48-uurs reminder",
      },
    ],
  },
  {
    id: "reminder-48u",
    label: "Reminder 48u",
    timing: "48 uur vóór afspraak",
    when: "Mail + SMS ~48 uur vóór de afspraak.",
    subject: "Over 2 dagen komt onze adviseur langs — Batterijconcept",
    html: previewHtml(afspraakReminder48uEmailV2(SAMPLE_V2)),
    sms: {
      label: "SMS (tegelijk met mail)",
      body: afspraakReminder48uSmsV2(SAMPLE_V2),
    },
  },
  {
    id: "avond-vooraf",
    label: "Avond vooraf",
    timing: "Avond vóór · 18:00–20:00",
    when: "Mail + SMS tegelijk, avond vóór rond 18:00–20:00.",
    subject: "Morgen komt onze adviseur langs — Batterijconcept",
    html: previewHtml(afspraakAvondVoorafEmailV2(SAMPLE_V2)),
    sms: {
      label: "SMS (tegelijk met mail)",
      body: afspraakAvondVoorafSmsV2(SAMPLE_V2),
    },
  },
];

const RUSTIG_MAILS = [
  {
    id: "bevestiging",
    label: "Bevestiging",
    timing: "Direct na inplannen",
    when: "Direct na inplannen — mail + SMS tegelijk (zelfde als intensief)",
    subject: "Afspraak bevestigd — Batterijconcept",
    html: previewHtml(afspraakBevestigingSequenceEmailV2(SAMPLE_V2)),
    sms: {
      label: "SMS (tegelijk met mail)",
      body: afspraakBevestigingSmsV2(SAMPLE_V2),
    },
  },
  {
    id: "avond-vooraf",
    label: "Avond vooraf",
    timing: "Avond vóór · 18:00–20:00",
    when: "Alleen SMS, avond vóór rond 18:00–20:00. Geen tussenmails.",
    smsOnly: true,
    sms: {
      label: "SMS avond vóór de afspraak",
      body: afspraakAvondVoorafSmsV2(SAMPLE_V2),
    },
  },
];

export default function EmailPreviewPage() {
  return (
    <EmailPreviewClient
      intensiefMails={INTENSIEF_MAILS}
      rustigMails={RUSTIG_MAILS}
      legacyMails={LEGACY_MAILS}
    />
  );
}

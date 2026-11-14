export type RecruitmentInboxTemplate = {
  id: string;
  label: string;
  subject?: string;
  body: string;
};

/** Eerste naam uit volledige naam (bijv. "Jona Hessel" → "Jona"). */
export function recruitmentVoornaam(naam: string | null | undefined): string {
  const first = (naam || "").trim().split(/\s+/)[0] || "";
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** Vul {{voornaam}} in templates; zonder naam → "Beste,". */
export function fillRecruitmentTemplate(
  body: string,
  naam: string | null | undefined
): string {
  const voornaam = recruitmentVoornaam(naam);
  if (voornaam) {
    return body
      .replaceAll("{{voornaam}}", voornaam)
      .replace(/^Beste,\s*$/m, `Beste ${voornaam},`);
  }
  return body
    .replaceAll("{{voornaam}}", "")
    .replace(/^Beste\s+,/m, "Beste,")
    .replace(/\n{3,}/g, "\n\n");
}

/** Snelle antwoorden voor recruitment-inbox (Apple Mail-achtig). */
export const RECRUITMENT_INBOX_TEMPLATES: RecruitmentInboxTemplate[] = [
  {
    id: "contact_binnenkort",
    label: "Ik contacteer u binnenkort",
    body: `Beste {{voornaam}},

Ik ga u contacteren in deze dagen. Dank voor uw mail.

Met vriendelijke groet,
BatterijConcept Recruitment`,
  },
  {
    id: "bedankt_interesse",
    label: "Bedankt voor je interesse",
    body: `Beste {{voornaam}},

Bedankt voor je mail en je interesse in BatterijConcept. We nemen zo snel mogelijk contact met je op.

Met vriendelijke groet,
BatterijConcept Recruitment`,
  },
  {
    id: "ontvangen_sollicitatie",
    label: "Sollicitatie ontvangen",
    body: `Beste {{voornaam}},

Bedankt voor je sollicitatie. We hebben je gegevens ontvangen en nemen binnenkort contact met je op om de volgende stap te bespreken.

Met vriendelijke groet,
BatterijConcept Recruitment`,
  },
  {
    id: "geen_interesse_ack",
    label: "Geen interesse — bevestiging",
    body: `Beste {{voornaam}},

Bedankt voor je bericht. We hebben genoteerd dat je geen interesse meer hebt. We stoppen met bellen en mailen hierover.

Succes verder!

Met vriendelijke groet,
BatterijConcept Recruitment`,
  },
  {
    id: "bereikbaarheid",
    label: "Wanneer ben je bereikbaar?",
    body: `Beste {{voornaam}},

Dank voor je mail. Wanneer ben je het beste telefonisch bereikbaar? Dan plannen we snel een kort gesprek in.

Met vriendelijke groet,
BatterijConcept Recruitment`,
  },
];

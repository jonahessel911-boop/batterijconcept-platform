/**
 * INFO-mailbox inbox (UX eerst; IMAP/SMTP volgt later).
 * Mappen + reply-templates + voorgestelde acties (service / afspraak-annulering / lead).
 */

export type InboxFolderId =
  | "inbox"
  | "algemeen"
  | "service"
  | "inkoop"
  | "lead_antwoorden"
  | "verzonden"
  | "archief";

export type InboxMailStatus = "nieuw" | "gelezen" | "afgehandeld" | "gearchiveerd";

/** Acties die later aan echte APIs gekoppeld worden. */
export type InboxActionId =
  | "maak_service_verzoek"
  | "annuleer_afspraak"
  | "lead_geen_contact"
  | "lead_geen_interesse"
  | "open_lead"
  | "open_project";

export type InboxMail = {
  id: string;
  folder: InboxFolderId;
  status: InboxMailStatus;
  fromName: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  receivedAt: string;
  /** Suggesties op basis van AI / heuristic */
  suggestedActions: InboxActionId[];
  suggestedFolder?: InboxFolderId;
  aiSummary?: string | null;
  aiReason?: string | null;
  aiConfidence?: number | null;
  aiClassifiedAt?: string | null;
  /** Side-effects van de AI function call (later echt uitvoeren) */
  aiEffects?: {
    createServiceVerzoek: boolean;
    cancelAfspraak: boolean;
    leadGeenContact: boolean;
    leadGeenInteresse: boolean;
  } | null;
  /** Gekoppelde entities (mock / later uit matching) */
  leadId?: string | null;
  leadNaam?: string | null;
  projectId?: string | null;
  projectNummer?: string | null;
  afspraakId?: string | null;
  threadId?: string;
  /** Uitgaande reply in deze thread (demo) */
  replies?: {
    id: string;
    at: string;
    subject: string;
    bodyText: string;
    templateId?: string | null;
  }[];
};

export type InboxReplyTemplate = {
  id: string;
  label: string;
  folders?: InboxFolderId[];
  subject: (mail: InboxMail) => string;
  body: (mail: InboxMail) => string;
};

export const INBOX_FOLDERS: {
  id: InboxFolderId;
  label: string;
  hint: string;
}[] = [
  { id: "inbox", label: "Alles", hint: "Alle niet-gearchiveerde mails" },
  {
    id: "algemeen",
    label: "Algemene klantvragen",
    hint: "Vragen over product, planning, info",
  },
  {
    id: "service",
    label: "Service",
    hint: "Storing / nazorg → serviceverzoek",
  },
  {
    id: "inkoop",
    label: "Inkoop",
    hint: "Leveranciers, leveringen, bestellingen",
  },
  {
    id: "lead_antwoorden",
    label: "Lead antwoorden",
    hint: "Geen contact, geen interesse, stop mail",
  },
  { id: "verzonden", label: "Verzonden", hint: "Jouw antwoorden" },
  { id: "archief", label: "Archief", hint: "Afgehandeld" },
];

export const INBOX_ACTION_LABEL: Record<InboxActionId, string> = {
  maak_service_verzoek: "Serviceverzoek maken",
  annuleer_afspraak: "Afspraak annuleren",
  lead_geen_contact: "Lead → geen contact",
  lead_geen_interesse: "Lead → geen interesse",
  open_lead: "Open lead",
  open_project: "Open project",
};

export const INBOX_REPLY_TEMPLATES: InboxReplyTemplate[] = [
  {
    id: "algemeen_bedankt",
    label: "Algemeen — we reageren",
    folders: ["algemeen", "inbox"],
    subject: (m) => `Re: ${m.subject.replace(/^Re:\s*/i, "")}`,
    body: (m) =>
      [
        `Hoi ${firstName(m.fromName)},`,
        "",
        "Bedankt voor je bericht. We hebben het ontvangen en nemen zo snel mogelijk contact met je op.",
        "",
        "Met vriendelijke groet,",
        "BatterijConcept",
        "info@batterijconcept.nl",
      ].join("\n"),
  },
  {
    id: "service_ontvangen",
    label: "Service — verzoek ontvangen",
    folders: ["service", "inbox"],
    subject: (m) => `Re: ${m.subject.replace(/^Re:\s*/i, "")}`,
    body: (m) =>
      [
        `Hoi ${firstName(m.fromName)},`,
        "",
        "Bedankt voor je melding. We hebben een serviceverzoek aangemaakt en plannen dit zo snel mogelijk in.",
        m.projectNummer
          ? `Projectreferentie: ${m.projectNummer}.`
          : "Zodra we je project gekoppeld hebben, ontvang je een bevestiging.",
        "",
        "Met vriendelijke groet,",
        "BatterijConcept Service",
      ].join("\n"),
  },
  {
    id: "afspraak_annulering_bevestigd",
    label: "Afspraak — annulering bevestigd",
    folders: ["algemeen", "inbox"],
    subject: (m) => `Re: ${m.subject.replace(/^Re:\s*/i, "")}`,
    body: (m) =>
      [
        `Hoi ${firstName(m.fromName)},`,
        "",
        "We hebben je afspraak geannuleerd zoals gevraagd. Wil je een nieuwe afspraak? Laat het weten, dan plannen we een nieuw moment.",
        "",
        "Met vriendelijke groet,",
        "BatterijConcept",
      ].join("\n"),
  },
  {
    id: "lead_stop_contact",
    label: "Lead — geen contact meer",
    folders: ["lead_antwoorden", "inbox"],
    subject: (m) => `Re: ${m.subject.replace(/^Re:\s*/i, "")}`,
    body: (m) =>
      [
        `Hoi ${firstName(m.fromName)},`,
        "",
        "Bedankt voor je bericht. We respecteren je wens en nemen geen verder contact meer op over dit onderwerp.",
        "",
        "Met vriendelijke groet,",
        "BatterijConcept",
      ].join("\n"),
  },
  {
    id: "inkoop_ontvangen",
    label: "Inkoop — bericht ontvangen",
    folders: ["inkoop", "inbox"],
    subject: (m) => `Re: ${m.subject.replace(/^Re:\s*/i, "")}`,
    body: (m) =>
      [
        `Hoi ${firstName(m.fromName)},`,
        "",
        "Bedankt voor je mail. We zetten dit intern door naar purchasing en komen erop terug.",
        "",
        "Met vriendelijke groet,",
        "BatterijConcept",
      ].join("\n"),
  },
];

function firstName(naam: string): string {
  const t = naam.trim();
  if (!t) return "daar";
  return t.split(/\s+/)[0] || "daar";
}

/** Demo-mails zodat de UX werkt vóór IMAP. */
export function createDemoInboxMails(now = new Date()): InboxMail[] {
  const iso = (hoursAgo: number) =>
    new Date(now.getTime() - hoursAgo * 3600_000).toISOString();

  // Nieuwe mails starten ongeboekt (algemeen tijdelijk); AI bookt ze automatisch.
  return [
    {
      id: "demo-svc-1",
      folder: "algemeen",
      status: "nieuw",
      fromName: "Jan de Vries",
      fromEmail: "jan.devries@example.com",
      toEmail: "info@batterijconcept.nl",
      subject: "Storing thuisbatterij — piept 's nachts",
      bodyText: [
        "Goedemiddag,",
        "",
        "Sinds gisteren piept onze batterij 's nachts. Installatie was vorige maand. Kunnen jullie langskomen?",
        "",
        "Groet, Jan",
      ].join("\n"),
      receivedAt: iso(2),
      suggestedActions: [],
      projectNummer: "BC-P-2026-0142",
      leadNaam: "Jan de Vries",
      aiClassifiedAt: null,
    },
    {
      id: "demo-afspraak-1",
      folder: "algemeen",
      status: "nieuw",
      fromName: "M. van Dalfsen",
      fromEmail: "connydesk@outlook.com",
      toEmail: "info@batterijconcept.nl",
      subject: "Afspraak annuleren a.u.b.",
      bodyText: [
        "Hallo,",
        "",
        "Ik wil graag onze huisbezoek-afspraak annuleren. Wegens omstandigheden lukt het niet. Geen annulering van een order — alleen de afspraak.",
        "",
        "Met vriendelijke groet,",
        "M. van Dalfsen",
      ].join("\n"),
      receivedAt: iso(5),
      suggestedActions: [],
      leadNaam: "M. van Dalfsen",
      afspraakId: "demo-afspraak",
      aiClassifiedAt: null,
    },
    {
      id: "demo-lead-1",
      folder: "algemeen",
      status: "nieuw",
      fromName: "Peter Jansen",
      fromEmail: "peter.jansen@example.nl",
      toEmail: "info@batterijconcept.nl",
      subject: "Re: Interesse thuisbatterij",
      bodyText: [
        "Hoi,",
        "",
        "Ik hoef geen contact meer, graag uit jullie belbestand. Bedankt.",
        "",
        "Peter",
      ].join("\n"),
      receivedAt: iso(8),
      suggestedActions: [],
      leadNaam: "Peter Jansen",
      aiClassifiedAt: null,
    },
    {
      id: "demo-inkoop-1",
      folder: "algemeen",
      status: "nieuw",
      fromName: "Apex Logistics",
      fromEmail: "orders@apex-example.com",
      toEmail: "info@batterijconcept.nl",
      subject: "Leverbevestiging order AX-88921",
      bodyText: [
        "Beste BatterijConcept,",
        "",
        "Order AX-88921 staat gepland voor levering donderdag. Tracking volgt.",
        "",
        "Groet, Apex",
      ].join("\n"),
      receivedAt: iso(20),
      suggestedActions: [],
      aiClassifiedAt: null,
    },
    {
      id: "demo-algemeen-1",
      folder: "algemeen",
      status: "nieuw",
      fromName: "Lisa Bakker",
      fromEmail: "lisa.bakker@example.com",
      toEmail: "info@batterijconcept.nl",
      subject: "Vraag over salderen en batterij",
      bodyText: [
        "Hallo,",
        "",
        "Ik heb zonnepanelen en overweeg een thuisbatterij. Wat levert dat ongeveer op bij 10 panelen?",
        "",
        "Groet, Lisa",
      ].join("\n"),
      receivedAt: iso(28),
      suggestedActions: [],
      leadNaam: "Lisa Bakker",
      aiClassifiedAt: null,
    },
  ];
}

export function mailInFolder(mail: InboxMail, folder: InboxFolderId): boolean {
  if (folder === "inbox") {
    return mail.folder !== "archief" && mail.folder !== "verzonden";
  }
  return mail.folder === folder;
}

export function unreadCount(
  mails: InboxMail[],
  folder: InboxFolderId
): number {
  return mails.filter(
    (m) => mailInFolder(m, folder) && m.status === "nieuw"
  ).length;
}

export function templatesForFolder(
  folder: InboxFolderId
): InboxReplyTemplate[] {
  return INBOX_REPLY_TEMPLATES.filter(
    (t) => !t.folders || t.folders.includes(folder) || t.folders.includes("inbox")
  );
}

/** Pas AI-boeking (function call) toe op een mail. */
export function applyInboxBooking(
  mail: InboxMail,
  result: {
    folder: Exclude<InboxFolderId, "inbox" | "verzonden" | "archief">;
    summary: string;
    confidence: number;
    functionName?: string;
    effects?: {
      createServiceVerzoek?: boolean;
      cancelAfspraak?: boolean;
      leadGeenContact?: boolean;
      leadGeenInteresse?: boolean;
    };
  }
): InboxMail {
  return {
    ...mail,
    folder: result.folder,
    suggestedFolder: result.folder,
    suggestedActions: [],
    aiSummary: result.summary,
    aiReason: result.functionName
      ? `Function: ${result.functionName}`
      : null,
    aiConfidence: result.confidence,
    aiClassifiedAt: new Date().toISOString(),
    aiEffects: result.effects
      ? {
          createServiceVerzoek: Boolean(result.effects.createServiceVerzoek),
          cancelAfspraak: Boolean(result.effects.cancelAfspraak),
          leadGeenContact: Boolean(result.effects.leadGeenContact),
          leadGeenInteresse: Boolean(result.effects.leadGeenInteresse),
        }
      : null,
  };
}

/** @deprecated gebruik applyInboxBooking */
export function applyInboxClassification(
  mail: InboxMail,
  result: {
    folder: Exclude<InboxFolderId, "inbox" | "verzonden" | "archief">;
    actions?: InboxActionId[];
    summary: string;
    reason?: string;
    confidence: number;
  }
): InboxMail {
  return applyInboxBooking(mail, {
    folder: result.folder,
    summary: result.summary,
    confidence: result.confidence,
    functionName: result.reason,
  });
}

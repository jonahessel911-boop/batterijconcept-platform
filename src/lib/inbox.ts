/**
 * INFO-mailbox: mappen + reply-templates + acties per mailtype.
 */

export type InboxFolderId =
  | "inbox"
  | "service"
  | "installatie"
  | "ordervraag"
  | "algemeen"
  | "afzegging_afspraak"
  | "annulering_vraag"
  | "verzonden"
  | "archief";

export type InboxMailStatus =
  | "nieuw"
  | "gelezen"
  | "afgehandeld"
  | "gearchiveerd";

export type InboxActionId =
  | "maak_service_verzoek"
  | "annuleer_afspraak"
  | "mark_geen_interesse"
  | "mark_geen_contact"
  | "open_lead"
  | "open_project";

export type InboxAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  storagePath: string;
  /** true = toon in fotogalerij */
  isImage?: boolean;
};

export function isInboxImageAttachment(a: InboxAttachment): boolean {
  if (a.isImage === true) return true;
  if (a.isImage === false) return false;
  const ct = (a.contentType || "").toLowerCase();
  if (ct.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(a.filename || "");
}

/** Unieke http(s)/data image-URL's uit HTML (geen tracking-pixels). */
export function extractImageUrlsFromHtml(html: string | null | undefined): string[] {
  const raw = (html || "").trim();
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const src = (m[1] || "").trim();
    if (!src) continue;
    const tag = m[0].toLowerCase();
    // Skip 1×1 / tracking pixels
    if (
      /\bwidth\s*=\s*["']?1["']?/.test(tag) &&
      /\bheight\s*=\s*["']?1["']?/.test(tag)
    ) {
      continue;
    }
    if (src.startsWith("cid:")) continue;
    if (src.startsWith("data:image/") && src.length < 800) continue;
    if (
      !/^https?:\/\//i.test(src) &&
      !src.startsWith("data:image/")
    ) {
      continue;
    }
    if (seen.has(src)) continue;
    seen.add(src);
    out.push(src);
    if (out.length >= 24) break;
  }
  return out;
}

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
  suggestedActions: InboxActionId[];
  suggestedFolder?: InboxFolderId;
  aiSummary?: string | null;
  aiReason?: string | null;
  aiConfidence?: number | null;
  aiClassifiedAt?: string | null;
  aiEffects?: {
    createServiceVerzoek: boolean;
    cancelAfspraak: boolean;
    leadGeenContact: boolean;
    leadGeenInteresse: boolean;
  } | null;
  leadId?: string | null;
  leadNaam?: string | null;
  projectId?: string | null;
  projectNummer?: string | null;
  afspraakId?: string | null;
  threadId?: string;
  messageId?: string | null;
  bodyHtml?: string | null;
  attachments?: InboxAttachment[];
  /** Externe of data-URL afbeeldingen uit de HTML (niet als bijlage). */
  imageUrls?: string[];
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

export type InboxBookFolder = Exclude<
  InboxFolderId,
  "inbox" | "verzonden" | "archief"
>;

/** Legacy DB-waarden → huidige mappen. */
export function normalizeInboxFolder(raw: string | null | undefined): InboxFolderId {
  const f = (raw || "").trim();
  switch (f) {
    case "service":
    case "installatie":
    case "ordervraag":
    case "algemeen":
    case "afzegging_afspraak":
    case "annulering_vraag":
    case "verzonden":
    case "archief":
      return f;
    case "inkoop":
      return "ordervraag";
    case "lead_antwoorden":
      return "algemeen";
    case "inbox":
      return "algemeen";
    default:
      return "algemeen";
  }
}

export type InboxHuisbezoek = "ja" | "nee" | "eerst";

export type InboxExtract = {
  emails: string[];
  phones: string[];
  postcode: string | null;
  plaats: string | null;
  panelen: number | null;
  merken: string[];
  huisbezoek: InboxHuisbezoek | null;
  afspraakAfzeggen: boolean;
};

const SKIP_MAIL_EMAIL =
  /@(batterijconcept\.nl|moneybird\.[a-z.]+|trustpilot\.com|voipzeker\.|facebook\.com|tiktok\.com|google\.com|apple\.com|alphaess\.com)\b/i;

const MERKEN = [
  "enphase",
  "alphaess",
  "alpha ess",
  "sigenergy",
  "sessy",
  "growatt",
  "solaredge",
  "tesla",
  "huawei",
  "byd",
  "pylontech",
  "foxess",
  "hyxi",
  "marstek",
];

/** Trek ingevulde gegevens uit een info-mail (adres, telefoon, huisbezoek, …). */
export function extractInboxFacts(input: {
  fromEmail?: string | null;
  subject?: string | null;
  bodyText?: string | null;
}): InboxExtract {
  const raw = `${input.subject || ""}\n${input.bodyText || ""}`;
  const text = raw.split(
    /Oorspronkelijk bericht|het volgende geschreven:|-----Original Message-----|Verzonden vanaf mijn/i
  )[0];
  const lower = text.toLowerCase();
  const from = (input.fromEmail || "").trim().toLowerCase();

  const emails = [
    ...new Set(
      [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
        .map((m) => m[0].toLowerCase())
        .filter((e) => e !== from && !SKIP_MAIL_EMAIL.test(e))
    ),
  ].slice(0, 3);

  const phones = [
    ...new Set(
      (
        text.match(/(?<!\d)(?:\+31|0031|0)[\d\s\-()]{8,16}(?!\d)/g) || []
      )
        .map((p) => p.replace(/\D/g, ""))
        .filter((d) => d.length >= 10 && !d.startsWith("000"))
        .map((d) => (d.startsWith("31") && d.length > 10 ? d.slice(2) : d))
        .map((d) => d.slice(-10))
    ),
  ].slice(0, 3);

  const postcodeWords = new Set([
    "om",
    "op",
    "de",
    "te",
    "in",
    "en",
    "of",
    "ok",
  ]);
  let postcode: string | null = null;
  for (const pc of text.matchAll(/\b([1-9]\d{3})\s?([A-Za-z]{2})\b/g)) {
    const letters = pc[2].toLowerCase();
    if (postcodeWords.has(letters)) continue;
    const before = text.slice(Math.max(0, (pc.index || 0) - 12), pc.index);
    if (/\b(?:jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)/i.test(before)) {
      continue;
    }
    postcode = `${pc[1]} ${pc[2].toUpperCase()}`;
    break;
  }

  const plaatsMatch = text.match(
    /\b(?:wonen|woon)\s+(?:bij|in|te)\s+([A-Za-zà-ÿ][A-Za-zà-ÿ' -]{2,30})/
  );
  const plaats = plaatsMatch
    ? plaatsMatch[1]
        .trim()
        .replace(/\s+/g, " ")
        .split(/\s+(?:en|met|voor|om|waar)\b/i)[0]
        .split(/[,.]/)[0]
        .trim()
    : null;

  const panelenMatch = lower.match(/\b(\d{1,2})\s+(?:zonne)?panelen\b/);
  const panelen = panelenMatch ? Number(panelenMatch[1]) : null;

  const merken = MERKEN.filter((m) => lower.includes(m)).map((m) =>
    m === "alpha ess" ? "AlphaESS" : m.charAt(0).toUpperCase() + m.slice(1)
  );

  let huisbezoek: InboxHuisbezoek | null = null;
  if (
    /huis\s*bezoek\s*wil\s*ik\s*niet|geen\s*huis\s*bezoek|liever\s*geen\s*huisbezoek|zonder\s*huisbezoek|huisbezoek\s*niet\b/.test(
      lower
    )
  ) {
    huisbezoek = "nee";
  } else if (
    /voordat.{0,50}huis\s*bezoek|eerst.{0,40}(indicatie|voorstel|kosten)|kosten.{0,40}voordat/.test(
      lower
    )
  ) {
    huisbezoek = "eerst";
  } else if (
    /huis\s*bezoek|afspraak\s*(graag\s*)?(inplannen|maken)|langs\s*komen|adviesgesprek/.test(
      lower
    )
  ) {
    huisbezoek = "ja";
  }

  const afspraakAfzeggen =
    /(afspraak|bezoek).{0,50}(cancel|annul|afzeg)|\bcancelen\b|\bafzeggen\b/.test(
      lower
    ) && !/\b(order|project|contract)\b/.test(lower);

  return {
    emails,
    phones,
    postcode,
    plaats,
    panelen: panelen && panelen > 0 && panelen < 80 ? panelen : null,
    merken,
    huisbezoek,
    afspraakAfzeggen,
  };
}

export function actionsForFolder(
  folder: InboxFolderId,
  effects?: InboxMail["aiEffects"] | null
): InboxActionId[] {
  switch (folder) {
    case "service":
      return ["maak_service_verzoek", "open_project", "open_lead"];
    case "installatie":
      return ["open_project", "open_lead"];
    case "ordervraag":
      return ["open_lead", "open_project"];
    case "afzegging_afspraak":
      return ["annuleer_afspraak", "open_lead"];
    case "annulering_vraag":
      return ["open_project", "open_lead"];
    case "algemeen":
      if (effects?.cancelAfspraak) return ["annuleer_afspraak", "open_lead"];
      if (effects?.createServiceVerzoek)
        return ["maak_service_verzoek", "open_lead"];
      if (effects?.leadGeenInteresse)
        return ["mark_geen_interesse", "open_lead"];
      if (effects?.leadGeenContact) return ["mark_geen_contact", "open_lead"];
      return ["open_lead"];
    default:
      return [];
  }
}

/** Detecteer "geen interesse" / "geen contact" uit mailtekst of AI-effects. */
export function mailSuggestsGeenInteresse(mail: InboxMail): boolean {
  if (mail.aiEffects?.leadGeenInteresse) return true;
  const t = `${mail.subject}\n${mail.bodyText}\n${mail.aiSummary || ""}`.toLowerCase();
  return /geen\s*interesse|niet\s*geïnteresseerd|niet\s*meer\s*interess|interesse\s*dank/.test(
    t
  );
}

export function mailSuggestsGeenContact(mail: InboxMail): boolean {
  if (mail.aiEffects?.leadGeenContact) return true;
  if (mailSuggestsGeenInteresse(mail)) return false;
  const t = `${mail.subject}\n${mail.bodyText}\n${mail.aiSummary || ""}`.toLowerCase();
  return /geen\s*contact|niet\s*bellen|uitschrijv|stop\s*(met\s*)?(mail|bellen)|haal\s*me\s*uit/.test(
    t
  );
}

export const INBOX_FOLDERS: {
  id: InboxFolderId;
  label: string;
  hint: string;
}[] = [
  { id: "inbox", label: "Alles", hint: "Open mails die nog actie nodig hebben" },
  {
    id: "service",
    label: "Service",
    hint: "Storing / nazorg → serviceverzoek",
  },
  {
    id: "installatie",
    label: "Installatie",
    hint: "Planning, schouw, montage, oplevering",
  },
  {
    id: "ordervraag",
    label: "Ordervraag",
    hint: "Vragen over een lopende of nieuwe order",
  },
  {
    id: "algemeen",
    label: "Algemeen",
    hint: "Overige klantvragen",
  },
  {
    id: "afzegging_afspraak",
    label: "Afzegging afspraak",
    hint: "Huisbezoek/afspraak afzeggen",
  },
  {
    id: "annulering_vraag",
    label: "Annulering vraag",
    hint: "Order/project/contract annuleren",
  },
  { id: "verzonden", label: "Verzonden", hint: "Jouw antwoorden" },
  { id: "archief", label: "Archief", hint: "Afgehandeld / verwijderd" },
];

export const INBOX_ACTION_LABEL: Record<InboxActionId, string> = {
  maak_service_verzoek: "Serviceverzoek maken",
  annuleer_afspraak: "Definitief afzeggen",
  mark_geen_interesse: 'Markeer lead als "Geen interesse"',
  mark_geen_contact: 'Markeer lead als "Geen contact"',
  open_lead: "Open lead",
  open_project: "Open project",
};

export const INBOX_REPLY_TEMPLATES: InboxReplyTemplate[] = [
  {
    id: "algemeen_bedankt",
    label: "Algemeen — we reageren",
    folders: ["algemeen", "ordervraag", "installatie", "inbox"],
    subject: (m) => `Re: ${m.subject.replace(/^Re:\s*/i, "")}`,
    body: (m) =>
      [
        `Beste ${firstName(m.fromName)},`,
        "",
        "Bedankt voor je bericht. We hebben het ontvangen en nemen zo snel mogelijk contact met je op.",
        "",
        "Met vriendelijke groet,",
        "BatterijConcept",
      ].join("\n"),
  },
  {
    id: "service_ontvangen",
    label: "Service — verzoek ontvangen",
    folders: ["service", "inbox"],
    subject: (m) => `Re: ${m.subject.replace(/^Re:\s*/i, "")}`,
    body: (m) =>
      [
        `Beste ${firstName(m.fromName)},`,
        "",
        "Bedankt voor je melding. We hebben een serviceverzoek aangemaakt en plannen dit zo snel mogelijk in.",
        m.projectNummer
          ? `Projectreferentie: ${m.projectNummer}.`
          : "Zodra we je project gekoppeld hebben, ontvang je een bevestiging.",
        "",
        "Met vriendelijke groet,",
        "BatterijConcept",
      ].join("\n"),
  },
  {
    id: "afspraak_afzegging_bevestigd",
    label: "Afspraak — afzegging bevestigd",
    folders: ["afzegging_afspraak", "inbox"],
    subject: (m) => `Re: ${m.subject.replace(/^Re:\s*/i, "")}`,
    body: (m) =>
      [
        `Beste ${firstName(m.fromName)},`,
        "",
        "We hebben je afspraak geannuleerd zoals gevraagd. Wil je een nieuwe afspraak? Laat het weten, dan plannen we een nieuw moment.",
        "",
        "Met vriendelijke groet,",
        "BatterijConcept",
      ].join("\n"),
  },
  {
    id: "annulering_ontvangen",
    label: "Annulering — ontvangen",
    folders: ["annulering_vraag", "inbox"],
    subject: (m) => `Re: ${m.subject.replace(/^Re:\s*/i, "")}`,
    body: (m) =>
      [
        `Beste ${firstName(m.fromName)},`,
        "",
        "Bedankt voor je bericht over de annulering. We kijken dit na in je dossier en nemen contact met je op over de vervolgstappen.",
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

/** Mail die nog open staat (nog geen antwoord / niet gearchiveerd). */
export function isOpenInboxMail(mail: InboxMail): boolean {
  if (mail.folder === "archief" || mail.folder === "verzonden") return false;
  if (mail.status === "afgehandeld" || mail.status === "gearchiveerd") {
    return false;
  }
  if ((mail.replies?.length ?? 0) > 0) return false;
  return true;
}

export function mailInFolder(mail: InboxMail, folder: InboxFolderId): boolean {
  if (folder === "archief" || folder === "verzonden") {
    return mail.folder === folder;
  }
  if (!isOpenInboxMail(mail)) return false;
  if (folder === "inbox") return true;
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
    folder: InboxBookFolder;
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
  const effects = result.effects
    ? {
        createServiceVerzoek: Boolean(result.effects.createServiceVerzoek),
        cancelAfspraak: Boolean(result.effects.cancelAfspraak),
        leadGeenContact: Boolean(result.effects.leadGeenContact),
        leadGeenInteresse: Boolean(result.effects.leadGeenInteresse),
      }
    : null;
  return {
    ...mail,
    folder: result.folder,
    suggestedFolder: result.folder,
    suggestedActions: actionsForFolder(result.folder, effects),
    aiSummary: result.summary,
    aiReason: result.functionName
      ? `Function: ${result.functionName}`
      : null,
    aiConfidence: result.confidence,
    aiClassifiedAt: new Date().toISOString(),
    aiEffects: effects,
  };
}

/** @deprecated gebruik applyInboxBooking */
export function applyInboxClassification(
  mail: InboxMail,
  result: {
    folder: InboxBookFolder;
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

/**
 * AI boekt inkomende INFO-mails via function calls naar een map.
 * Mappen: service | installatie | ordervraag | algemeen |
 * afzegging_afspraak | annulering_vraag
 */

import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { extractInboxFacts, type InboxBookFolder } from "@/lib/inbox";

export type InboxBookResult = {
  functionName:
    | "book_to_service"
    | "book_to_installatie"
    | "book_to_ordervraag"
    | "book_to_algemeen"
    | "book_to_afzegging_afspraak"
    | "book_to_annulering_vraag";
  folder: InboxBookFolder;
  summary: string;
  confidence: number;
  source: "ai" | "heuristic";
  effects: {
    createServiceVerzoek: boolean;
    /** Huisbezoek/afspraak afzeggen — NOOIT order-annulering */
    cancelAfspraak: boolean;
    leadGeenContact: boolean;
    leadGeenInteresse: boolean;
  };
};

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "book_to_service",
      description:
        "Map Service: storing, defect, nazorg, garantie, piept, werkt niet ná oplevering. Serviceverzoek volgt.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Max 1 zin NL" },
          confidence: { type: "number" },
          create_service_verzoek: {
            type: "boolean",
            description: "true als er een serviceverzoek moet komen",
          },
        },
        required: ["summary", "confidence", "create_service_verzoek"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_to_installatie",
      description:
        "Map Installatie: schouw, montage, installatiedatum, oplevering, monteur, wanneer komen jullie, herplannen installatie.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["summary", "confidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_to_ordervraag",
      description:
        "Map Ordervraag: vraag over lopende/nieuwe order, offerte, prijs, levering van het product, status van de order (geen annulering).",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["summary", "confidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_to_afzegging_afspraak",
      description:
        "Map Afzegging afspraak: klant wil huisbezoek/verkoopafspraak/schouw-afspraak afzeggen of verzetten-annuleren. NIET order/project annuleren.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["summary", "confidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_to_annulering_vraag",
      description:
        "Map Annulering vraag: order/project/contract annuleren, herroeping, annuleringskosten. NIET huisbezoek-afzegging.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["summary", "confidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_to_algemeen",
      description:
        "Map Algemeen: overige vragen, info, nieuwsbrief, notificatie, onduidelijk, OF klant die geen interesse / geen contact meer wil. Geen service/installatie/order/annulering.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          confidence: { type: "number" },
          lead_geen_interesse: {
            type: "boolean",
            description:
              "true als de klant expliciet geen interesse meer heeft",
          },
          lead_geen_contact: {
            type: "boolean",
            description:
              "true als de klant geen verder contact/mail/bellen wil (zonder expliciet geen interesse)",
          },
        },
        required: ["summary", "confidence"],
      },
    },
  },
];

const SYSTEM_PROMPT = `Je bent de mailbox-router voor BatterijConcept (info@).
Roep EXACT ÉÉN function call aan. Geen tekstantwoord.
Boek op basis van onderwerp + body.

Regels (prioriteit):
1. Afzegging huisbezoek/afspraak → book_to_afzegging_afspraak.
2. Order/project/contract annuleren of annuleringskosten → book_to_annulering_vraag (NOOIT afzegging_afspraak).
3. Storing/nazorg/defect na oplevering → book_to_service (create_service_verzoek meestal true).
4. Installatie/schouw/montage/oplevering plannen → book_to_installatie.
5. Vraag over order/offerte/prijs/status (geen annulering) → book_to_ordervraag.
6. "Geen interesse" / stop contact → book_to_algemeen met lead_geen_interesse of lead_geen_contact true.
7. Rest → book_to_algemeen.
8. Bij twijfel: book_to_algemeen, lagere confidence.`;

export function openaiInboxConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function getClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY ontbreekt");
  return new OpenAI({ apiKey: key });
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function emptyEffects(): InboxBookResult["effects"] {
  return {
    createServiceVerzoek: false,
    cancelAfspraak: false,
    leadGeenContact: false,
    leadGeenInteresse: false,
  };
}

function resultFromTool(
  name: string,
  args: Record<string, unknown>,
  source: "ai" | "heuristic"
): InboxBookResult {
  const summary =
    typeof args.summary === "string" && args.summary.trim()
      ? args.summary.trim().slice(0, 200)
      : "Geboekt.";
  const confidence = clamp01(Number(args.confidence));
  const effects = emptyEffects();

  switch (name) {
    case "book_to_service":
      effects.createServiceVerzoek = args.create_service_verzoek !== false;
      return {
        functionName: "book_to_service",
        folder: "service",
        summary,
        confidence,
        source,
        effects,
      };
    case "book_to_installatie":
      return {
        functionName: "book_to_installatie",
        folder: "installatie",
        summary,
        confidence,
        source,
        effects,
      };
    case "book_to_ordervraag":
      return {
        functionName: "book_to_ordervraag",
        folder: "ordervraag",
        summary,
        confidence,
        source,
        effects,
      };
    case "book_to_afzegging_afspraak":
      effects.cancelAfspraak = true;
      return {
        functionName: "book_to_afzegging_afspraak",
        folder: "afzegging_afspraak",
        summary,
        confidence,
        source,
        effects,
      };
    case "book_to_annulering_vraag":
      return {
        functionName: "book_to_annulering_vraag",
        folder: "annulering_vraag",
        summary,
        confidence,
        source,
        effects,
      };
    case "book_to_algemeen":
    default:
      effects.leadGeenInteresse = Boolean(args.lead_geen_interesse);
      effects.leadGeenContact = Boolean(args.lead_geen_contact);
      return {
        functionName: "book_to_algemeen",
        folder: "algemeen",
        summary,
        confidence,
        source,
        effects,
      };
  }
}

export function bookInboxMailHeuristic(input: {
  subject: string;
  bodyText: string;
  fromEmail?: string;
}): InboxBookResult {
  const text = `${input.subject}\n${input.bodyText}`.toLowerCase();

  const orderCancel =
    /annuleringskosten|order\s*annul|project\s*annul|contract\s*annul|herroep|wil(l)?\s+(de\s+)?order\s*annul/.test(
      text
    ) && !/huisbezoek|afspraak\s*annul|bezoek\s*annul|afzeg/.test(text);

  if (orderCancel) {
    return resultFromTool(
      "book_to_annulering_vraag",
      { summary: "Vraag over order-/projectannulering.", confidence: 0.78 },
      "heuristic"
    );
  }

  const afspraakCancel =
    /(afspraak|huisbezoek|bezoek).{0,40}(annul|afzeg)|annul.{0,40}(afspraak|huisbezoek|bezoek)|afzeg|wil(l)?\s+(de\s+)?afspraak\s+annul/.test(
      text
    );
  if (afspraakCancel) {
    return resultFromTool(
      "book_to_afzegging_afspraak",
      {
        summary: "Klant wil afspraak/huisbezoek afzeggen.",
        confidence: 0.8,
      },
      "heuristic"
    );
  }

  if (
    /geen\s*interesse|niet\s*geïnteresseerd|niet\s*meer\s*interess|interesse\s*dank/.test(
      text
    )
  ) {
    return resultFromTool(
      "book_to_algemeen",
      {
        summary: "Klant heeft geen interesse.",
        confidence: 0.85,
        lead_geen_interesse: true,
      },
      "heuristic"
    );
  }

  if (
    /geen\s*contact|niet\s*bellen|uitschrijv|stop\s*(met\s*)?(mail|bellen)|haal\s*me\s*uit|niet\s*meer\s*benader/.test(
      text
    )
  ) {
    return resultFromTool(
      "book_to_algemeen",
      {
        summary: "Klant wil geen verder contact.",
        confidence: 0.8,
        lead_geen_contact: true,
      },
      "heuristic"
    );
  }

  if (
    /storing|defect|piept|garantie|nazorg|serviceverzoek|werkt niet|foutmelding/.test(
      text
    )
  ) {
    return resultFromTool(
      "book_to_service",
      {
        summary: "Service-/storingsmelding.",
        confidence: 0.72,
        create_service_verzoek: true,
      },
      "heuristic"
    );
  }

  if (
    /installatie|schouw|montage|oplevering|monteur|wanneer komen|installatiedatum|plaatsing/.test(
      text
    )
  ) {
    return resultFromTool(
      "book_to_installatie",
      { summary: "Vraag over installatie/planning.", confidence: 0.7 },
      "heuristic"
    );
  }

  if (
    /offerte|order|bestelling|prijs|salderen|thuisbatterij|levertermijn|status van (mijn )?order/.test(
      text
    )
  ) {
    return resultFromTool(
      "book_to_ordervraag",
      { summary: "Ordervraag / productvraag.", confidence: 0.62 },
      "heuristic"
    );
  }

  return resultFromTool(
    "book_to_algemeen",
    { summary: "Algemene klantvraag.", confidence: 0.45 },
    "heuristic"
  );
}

export async function bookInboxMail(input: {
  subject: string;
  bodyText: string;
  fromName?: string;
  fromEmail?: string;
}): Promise<InboxBookResult> {
  if (!openaiInboxConfigured()) {
    return bookInboxMailHeuristic(input);
  }

  const client = getClient();
  const userContent = [
    `Van: ${input.fromName || "—"} <${input.fromEmail || "—"}>`,
    `Onderwerp: ${input.subject || "(geen)"}`,
    "",
    "Bericht:",
    (input.bodyText || "").slice(0, 6000),
  ].join("\n");

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    temperature: 0,
    tools: TOOLS,
    tool_choice: "required",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") {
    return bookInboxMailHeuristic(input);
  }

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(toolCall.function.arguments || "{}") as Record<
      string,
      unknown
    >;
  } catch {
    args = {};
  }

  const result = resultFromTool(toolCall.function.name, args, "ai");
  const blob = `${input.subject}\n${input.bodyText}`.toLowerCase();

  // Hard guards
  if (
    result.folder === "afzegging_afspraak" &&
    /annuleringskosten|order\s*annul|project\s*annul|contract\s*annul/.test(
      blob
    ) &&
    !/huisbezoek|afspraak|bezoek|afzeg/.test(blob)
  ) {
    return resultFromTool(
      "book_to_annulering_vraag",
      {
        summary: result.summary || "Order-/projectannulering.",
        confidence: Math.min(result.confidence, 0.7),
      },
      "ai"
    );
  }

  return result;
}

/** Altijd één nette Re:-regel (geen Re: Re: …). */
export function normalizeReplySubject(raw: string | null | undefined): string {
  let s = (raw || "").trim();
  if (!s) return "Re: (geen onderwerp)";
  // Strip herhaalde reply-prefixen (Re:/RE:/Aw:/AW:/Antw:)
  for (let i = 0; i < 8; i += 1) {
    const next = s.replace(/^(re|aw|antw|antwoord)\s*:\s*/i, "").trim();
    if (next === s) break;
    s = next;
  }
  if (!s) s = "(geen onderwerp)";
  return `Re: ${s}`;
}

function firstNameFrom(naam: string | null | undefined): string {
  const t = (naam || "").trim();
  if (!t) return "";
  return t.split(/\s+/)[0] || t;
}

function actieRegel(
  intent: "ja" | "nee" | "eerst" | null,
  klantEmail: string
): string {
  if (!klantEmail) return "";
  if (intent === "ja") {
    return `We plannen het huisbezoek op ${klantEmail}. Antwoord gerust op deze mail, dan komt het binnen op info@batterijconcept.nl en pakken we het direct op.`;
  }
  if (intent === "nee") {
    return `We sturen het voorstel naar ${klantEmail}, zonder huisbezoek. Antwoord op deze mail komt binnen op info@batterijconcept.nl.`;
  }
  if (intent === "eerst") {
    return `Je krijgt eerst een indicatie op ${klantEmail}. Een huisbezoek plannen we alleen als je dat wilt. Antwoord op deze mail komt binnen op info@batterijconcept.nl.`;
  }
  return "";
}

export async function draftInboxReply(input: {
  subject: string;
  bodyText: string;
  fromName?: string;
  fromEmail?: string;
  /** E-mailadres van de klant in het CRM, als dat afwijkt van de afzender. */
  klantEmail?: string | null;
  agentNaam?: string;
}): Promise<{ subject: string; body: string }> {
  const subject = normalizeReplySubject(input.subject);
  const voornaam = firstNameFrom(input.fromName) || "daar";
  const agent = (input.agentNaam || "").trim() || "BatterijConcept";
  const klantEmail = (
    input.klantEmail ||
    input.fromEmail ||
    ""
  ).trim();
  const facts = extractInboxFacts({
    fromEmail: input.fromEmail,
    subject: input.subject,
    bodyText: input.bodyText,
  });
  const visitLine = actieRegel(facts.huisbezoek, klantEmail);

  if (!openaiInboxConfigured()) {
    const extra = visitLine ? `\n\n${visitLine}` : "";
    return {
      subject,
      body: `Beste ${voornaam},\n\nBedankt voor je bericht. Een huisbezoek is de snelste manier om te zien welke thuisbatterij bij je past — we vergelijken de A-merken bij je thuis en adviseren wat echt rendeert.${extra}\n\nMet vriendelijke groet,\n${agent}`.trim(),
    };
  }

  const client = getClient();
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    temperature: 0.45,
    messages: [
      {
        role: "system",
        content: [
          "Je schrijft commerciële e-mailconcepten voor BatterijConcept (info@) aan klanten.",
          "Je levert ALLEEN de mailbody (geen onderwerpregel — die wordt apart als Re: gezet).",
          "",
          "TOON:",
          "- Commercieel en uitnodigend: je wilt de afspraak. Zelfverzekerd, warm, concreet. Geen afwachtende helpdesk.",
          "- Je/jij, tenzij de klant duidelijk u/uw schrijft.",
          "- Korte zinnen. Geen HTML, geen emoji.",
          "- Noem het voordeel: advies op locatie, de A-merken naast elkaar, een batterij die bij hun huis en verbruik past.",
          "",
          "INHOUD:",
          "- Beantwoord hun vraag en stuur meteen naar de volgende stap: een huisbezoek.",
          "- Verzin geen prijzen en stuur geen offerte op afstand. Het huisbezoek ís het aanbod.",
          "- Eén duidelijke call to action: plan het bezoek.",
          facts.huisbezoek === "nee"
            ? `- De klant wil géén huisbezoek. Dring niet aan. Zet deze zin letterlijk in de mail, vóór de groet: "${visitLine}"`
            : facts.huisbezoek === "eerst"
              ? `- De klant wil eerst een indicatie, nog geen huisbezoek. Zet deze zin letterlijk in de mail, vóór de groet: "${visitLine}"`
              : facts.huisbezoek === "ja"
                ? `- De klant wil een huisbezoek. Zet deze zin letterlijk in de mail, vóór de groet: "${visitLine}"`
                : "- Nodig uit voor een huisbezoek. Noem info@batterijconcept.nl als het adres waarop we antwoorden oppakken.",
          "",
          "VORM:",
          `- Begin met: Beste ${voornaam},`,
          `- Eindig met: Met vriendelijke groet,\\n${agent}`,
          "- Max ~150 woorden.",
          "- Geen 'Onderwerp:', geen 'Re:', geen Subject-regel in de body.",
          "- Geen intern jargon, geen 'AI'.",
          klantEmail
            ? `- Klant-e-mail voor het huisbezoek: ${klantEmail}. Gebruik dat adres, niet een ander.`
            : "",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Van: ${input.fromName || ""} <${input.fromEmail || ""}>`,
          klantEmail ? `E-mail in het CRM: ${klantEmail}` : "",
          `Onderwerp van de inkomende mail: ${input.subject || "(geen)"}`,
          `Antwoord-onderwerp (al vastgezet, niet herhalen): ${subject}`,
          "",
          "Schrijf nu een goede, inhoudelijke reply-body op dit bericht:",
          input.bodyText.slice(0, 4000),
        ].join("\n"),
      },
    ],
  });

  let body =
    completion.choices[0]?.message?.content?.trim() ||
    `Beste ${voornaam},\n\nBedankt voor je bericht.\n\nMet vriendelijke groet,\n${agent}`;

  // Strip per ongeluk meegeschreven onderwerp/Re:
  body = body
    .replace(/^(onderwerp|subject|re)\s*:\s*.+\n+/i, "")
    .trim();

  if (!/^Beste\s/i.test(body)) {
    body = `Beste ${voornaam},\n\n${body}`;
  }
  if (!/vriendelijke groet/i.test(body)) {
    body = `${body}\n\nMet vriendelijke groet,\n${agent}`;
  }
  if (visitLine && !body.includes(klantEmail)) {
    body = body.replace(
      /Met vriendelijke groet,/i,
      `${visitLine}\n\nMet vriendelijke groet,`
    );
  }

  return { subject, body };
}

/**
 * AI boekt inkomende INFO-mails via function calls naar een map.
 * Geen losse UI-acties — alleen: service | inkoop | algemeen | lead_antwoorden.
 */

import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { InboxFolderId } from "@/lib/inbox";

export type InboxBookFolder = Exclude<
  InboxFolderId,
  "inbox" | "verzonden" | "archief"
>;

export type InboxBookResult = {
  /** Function call die is uitgevoerd */
  functionName:
    | "book_to_service"
    | "book_to_inkoop"
    | "book_to_algemeen"
    | "book_to_lead_antwoorden";
  folder: InboxBookFolder;
  summary: string;
  confidence: number;
  source: "ai" | "heuristic";
  /** Side-effects die later echt uitgevoerd worden */
  effects: {
    createServiceVerzoek: boolean;
    /** Huisbezoek/afspraak annuleren — NOOIT order-annulering */
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
        "Boek de mail in map Service: storing, defect, nazorg, garantie, piept, installatieprobleem na oplevering. Maakt later een serviceverzoek aan.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Max 1 zin NL: wat de klant wil",
          },
          confidence: { type: "number", description: "0 tot 1" },
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
      name: "book_to_inkoop",
      description:
        "Boek in map Inkoop: leveranciers, leveringen, tracking, bestellingen, Apex, materiaal, pakbonnen.",
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
      name: "book_to_lead_antwoorden",
      description:
        "Boek in map Lead antwoorden: geen contact, niet bellen, uitschrijven, geen interesse, stop mail.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          confidence: { type: "number" },
          lead_geen_contact: {
            type: "boolean",
            description: "true als klant geen verder contact wil",
          },
          lead_geen_interesse: {
            type: "boolean",
            description: "true als expliciet geen interesse / vertrouwt niet",
          },
        },
        required: [
          "summary",
          "confidence",
          "lead_geen_contact",
          "lead_geen_interesse",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_to_algemeen",
      description:
        "Boek in map Algemene klantvragen: productvragen, planning, prijs, info, herplannen, OF afspraak-annulering (huisbezoek). NIET voor order-/projectannulering als primary service/inkoop.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          confidence: { type: "number" },
          cancel_afspraak: {
            type: "boolean",
            description:
              "true ALLEEN bij annulering van een huisbezoek/afspraak. false bij order/project/contract-annulering.",
          },
        },
        required: ["summary", "confidence", "cancel_afspraak"],
      },
    },
  },
];

const SYSTEM_PROMPT = `Je bent de mailbox-router voor BatterijConcept (info@).
Roep EXACT ÉÉN function call aan om de mail te boeken in de juiste map.
Geen tekstantwoord — alleen de tool call.

Regels:
1. Service = storing/nazorg/defect → book_to_service (create_service_verzoek meestal true).
2. Inkoop = leverancier/levering/order/tracking → book_to_inkoop.
3. Lead antwoorden = stop contact / geen interesse → book_to_lead_antwoorden.
4. Rest → book_to_algemeen.
5. Afspraak/huisbezoek annuleren → book_to_algemeen met cancel_afspraak=true.
6. Order/project/contract annuleren of annuleringskosten → book_to_algemeen met cancel_afspraak=false. NOOIT als afspraak-annulering behandelen.
7. Bij twijfel: book_to_algemeen, lagere confidence.`;

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
    case "book_to_inkoop":
      return {
        functionName: "book_to_inkoop",
        folder: "inkoop",
        summary,
        confidence,
        source,
        effects,
      };
    case "book_to_lead_antwoorden":
      effects.leadGeenContact = Boolean(args.lead_geen_contact);
      effects.leadGeenInteresse = Boolean(args.lead_geen_interesse);
      if (!effects.leadGeenContact && !effects.leadGeenInteresse) {
        effects.leadGeenContact = true;
      }
      return {
        functionName: "book_to_lead_antwoorden",
        folder: "lead_antwoorden",
        summary,
        confidence,
        source,
        effects,
      };
    case "book_to_algemeen":
    default:
      effects.cancelAfspraak = Boolean(args.cancel_afspraak);
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

/** Heuristic → zelfde function-call resultaat. */
export function bookInboxMailHeuristic(input: {
  subject: string;
  bodyText: string;
  fromEmail?: string;
}): InboxBookResult {
  const text = `${input.subject}\n${input.bodyText}`.toLowerCase();
  const from = (input.fromEmail || "").toLowerCase();

  const orderCancel =
    /annuleringskosten|order\s*annul|project\s*annul|contract\s*annul|herroep/.test(
      text
    ) && !/huisbezoek|afspraak\s*annul|bezoek\s*annul/.test(text);

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
    /levering|leverancier|tracking|bestelling|inkoop|apex|pakbon|verzending/.test(
      text
    ) ||
    /apex|leverancier|logistics|dhl|ups|postnl/.test(from)
  ) {
    return resultFromTool(
      "book_to_inkoop",
      { summary: "Inkoop-/leveranciersmail.", confidence: 0.7 },
      "heuristic"
    );
  }

  if (
    /geen\s*contact|niet\s*bellen|uitschrijv|stop\s*(met\s*)?(mail|bellen)|geen\s*interesse|haal\s*me\s*uit|niet\s*meer\s*benader/.test(
      text
    )
  ) {
    const geenInteresse = /geen\s*interesse|vertrouw/.test(text);
    return resultFromTool(
      "book_to_lead_antwoorden",
      {
        summary: geenInteresse
          ? "Lead: geen interesse."
          : "Lead: geen verder contact.",
        confidence: 0.75,
        lead_geen_contact: !geenInteresse,
        lead_geen_interesse: geenInteresse,
      },
      "heuristic"
    );
  }

  const afspraakCancel =
    !orderCancel &&
    /(afspraak|huisbezoek|bezoek).{0,40}(annul|afzeg)|annul.{0,40}(afspraak|huisbezoek|bezoek)|wil(l)?\s+(de\s+)?afspraak\s+annul/.test(
      text
    );

  if (afspraakCancel) {
    return resultFromTool(
      "book_to_algemeen",
      {
        summary: "Afspraak/huisbezoek annuleren (geen order).",
        confidence: 0.78,
        cancel_afspraak: true,
      },
      "heuristic"
    );
  }

  return resultFromTool(
    "book_to_algemeen",
    {
      summary: orderCancel
        ? "Order-/projectgerelateerd — algemeen (geen afspraak-annulering)."
        : "Algemene klantvraag.",
      confidence: orderCancel ? 0.65 : 0.45,
      cancel_afspraak: false,
    },
    "heuristic"
  );
}

/**
 * AI kiest één book_to_* function call en boekt de mail.
 */
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
  // Hard guard: nooit afspraak-annuleren als tekst duidelijk order is
  const blob = `${input.subject}\n${input.bodyText}`.toLowerCase();
  if (
    result.effects.cancelAfspraak &&
    /annuleringskosten|order\s*annul|project\s*annul/.test(blob) &&
    !/huisbezoek|afspraak/.test(blob)
  ) {
    result.effects.cancelAfspraak = false;
  }
  return result;
}

/** @deprecated alias — gebruik bookInboxMail */
export async function classifyInboxMail(input: {
  subject: string;
  bodyText: string;
  fromName?: string;
  fromEmail?: string;
}): Promise<
  InboxBookResult & {
    folder: InboxBookFolder;
    actions: string[];
    reason: string;
  }
> {
  const booked = await bookInboxMail(input);
  return {
    ...booked,
    folder: booked.folder,
    actions: [],
    reason: booked.functionName,
  };
}

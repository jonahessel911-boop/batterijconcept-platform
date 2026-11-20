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
    createTerugbel: boolean;
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
          create_terugbel: {
            type: "boolean",
            description:
              "true als de klant teruggebeld wil worden of zegt wanneer hij/zij bereikbaar is (vanmiddag, maandag, bel me, …)",
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
7. Klant wil teruggebeld worden of noemt wanneer hij/zij bereikbaar is (“bel me”, “vanmiddag bereikbaar”, “maandag bellen”) → book_to_algemeen met create_terugbel true (NIET lead_geen_contact).
8. Rest → book_to_algemeen.
9. Bij twijfel: book_to_algemeen, lagere confidence.`;

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
    createTerugbel: false,
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
      effects.createTerugbel = Boolean(args.create_terugbel);
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
    /bel\s*me|bel\s*mij|terugbel|terug\s*bellen|vanmiddag\s+bereikbaar|morgen\s+bereikbaar|maandag\s+bereikbaar|telefonisch\s+bereikbaar/.test(
      text
    ) &&
    !/niet\s*(meer\s*)?bellen|geen\s*contact/.test(text)
  ) {
    return resultFromTool(
      "book_to_algemeen",
      {
        summary: "Klant wil teruggebeld worden / is bereikbaar.",
        confidence: 0.82,
        create_terugbel: true,
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

export type InboxDraftThreadMessage = {
  fromUs: boolean;
  fromName?: string;
  at?: string;
  subject?: string;
  body: string;
};

export type InboxDraftContext = {
  folder?: string | null;
  aiSummary?: string | null;
  cancelAfspraak?: boolean;
  leadGeenContact?: boolean;
  leadGeenInteresse?: boolean;
  createServiceVerzoek?: boolean;
  leadNaam?: string | null;
  leadStatus?: string | null;
  leadPlaats?: string | null;
  leadNumber?: string | null;
  projectNummer?: string | null;
  projectStatus?: string | null;
  afspraak?: {
    startAt?: string | null;
    status?: string | null;
    soort?: string | null;
    adviseurNaam?: string | null;
  } | null;
};

function stripQuotedMailBody(raw: string): string {
  const text = (raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  const patterns = [
    /\nOn .+ wrote:\s*\n/i,
    /\nOp .+ schreef .+:\s*\n/i,
    /\nFrom:\s+.+\nSent:\s+/i,
    /\nVan:\s+.+\nVerzonden:\s+/i,
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\nOorspronkelijk bericht/i,
    /\n-{5,}Original Message-{5,}/i,
  ];
  let cut = -1;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && (cut < 0 || m.index < cut)) cut = m.index;
  }
  const sliced = cut > 20 ? text.slice(0, cut).trim() : text;
  return sliced.slice(0, 1800);
}

function formatDraftWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });
}

function formatThreadForDraft(thread: InboxDraftThreadMessage[]): {
  latestKlant: string;
  history: string;
} {
  const cleaned = thread
    .map((m) => ({
      ...m,
      body: stripQuotedMailBody(m.body),
    }))
    .filter((m) => m.body.trim());
  if (cleaned.length === 0) {
    return { latestKlant: "", history: "" };
  }
  const lastKlantIdx = [...cleaned]
    .map((m, i) => (!m.fromUs ? i : -1))
    .filter((i) => i >= 0)
    .pop();
  const latestIdx =
    lastKlantIdx != null ? lastKlantIdx : cleaned.length - 1;
  const latest = cleaned[latestIdx]!;
  const latestKlant = [
    latest.subject ? `Onderwerp: ${latest.subject}` : "",
    latest.body,
  ]
    .filter(Boolean)
    .join("\n");
  const prior = cleaned.filter((_, i) => i !== latestIdx).slice(-8);
  const history = prior
    .map((m) => {
      const wie = m.fromUs
        ? "BatterijConcept"
        : m.fromName || "Klant";
      const wanneer = formatDraftWhen(m.at);
      return `[${wie}${wanneer ? ` · ${wanneer}` : ""}]\n${m.body}`;
    })
    .join("\n\n");
  return { latestKlant, history };
}

function draftIntentHint(
  input: {
    subject: string;
    bodyText: string;
  },
  ctx?: InboxDraftContext | null
): string {
  const blob = `${input.subject}\n${input.bodyText}`.toLowerCase();
  if (
    ctx?.cancelAfspraak ||
    ctx?.folder === "afzegging_afspraak" ||
    /(afspraak|huisbezoek|bezoek).{0,40}(annul|afzeg)|geen bezoek|niet meer te bellen|er van af/.test(
      blob
    )
  ) {
    return "afzegging";
  }
  if (ctx?.leadGeenContact || /geen contact|niet meer bellen|stop met (mailen|bellen)/.test(blob)) {
    return "geen_contact";
  }
  if (ctx?.leadGeenInteresse || /geen interesse/.test(blob)) {
    return "geen_interesse";
  }
  if (ctx?.folder === "annulering_vraag" || /annuleringskosten|order annul|project annul/.test(blob)) {
    return "annulering";
  }
  if (ctx?.createServiceVerzoek || ctx?.folder === "service") {
    return "service";
  }
  if (ctx?.folder === "installatie") return "installatie";
  if (ctx?.folder === "ordervraag") return "ordervraag";
  return "algemeen";
}

function draftInboxReplyHeuristic(input: {
  subject: string;
  bodyText: string;
  voornaam: string;
  agent: string;
  ctx?: InboxDraftContext | null;
}): { subject: string; body: string } {
  const subject = normalizeReplySubject(input.subject);
  const intent = draftIntentHint(input, input.ctx);
  const afspraak = input.ctx?.afspraak;
  const wanneer = formatDraftWhen(afspraak?.startAt);
  let midden: string;
  switch (intent) {
    case "afzegging":
      midden = wanneer
        ? `We hebben je bericht gelezen: je wilt de afspraak${wanneer ? ` van ${wanneer}` : ""} niet laten doorgaan. We zetten die afspraak stop en bellen je hier niet meer voor na.`
        : "We hebben je bericht gelezen en zetten de afspraak stop. We bellen je hier niet meer voor na.";
      break;
    case "geen_contact":
      midden =
        "We hebben je verzoek ontvangen: we nemen geen contact meer met je op. Sorry voor het ongemak.";
      break;
    case "geen_interesse":
      midden =
        "Bedankt voor je terugkoppeling. We noteren dat je geen interesse hebt en laten het hierbij.";
      break;
    case "annulering":
      midden =
        "Bedankt voor je bericht over de annulering. We kijken dit na in je dossier en laten je weten wat de vervolgstappen zijn. We beloven nu niets over kosten of termijnen totdat dat helder is.";
      break;
    case "service":
      midden =
        "Bedankt voor je melding. We hebben je bericht intern doorgezet naar service en pakken dit zo snel mogelijk op. Zodra we meer weten, hoor je van ons.";
      break;
    case "installatie":
      midden =
        "Bedankt voor je bericht over de installatie. We kijken de planning na en komen bij je terug met een concreet antwoord — zonder iets te beloven dat we nog niet zeker weten.";
      break;
    default:
      midden =
        "Bedankt voor je bericht. We hebben het gelezen en komen hier zo snel mogelijk inhoudelijk op terug.";
  }
  return {
    subject,
    body: `Beste ${input.voornaam},\n\n${midden}\n\nMet vriendelijke groet,\n${input.agent}`,
  };
}

export async function draftInboxReply(input: {
  subject: string;
  bodyText: string;
  fromName?: string;
  fromEmail?: string;
  /** E-mailadres van de klant in het CRM, als dat afwijkt van de afzender. */
  klantEmail?: string | null;
  agentNaam?: string;
  thread?: InboxDraftThreadMessage[];
  context?: InboxDraftContext | null;
}): Promise<{ subject: string; body: string }> {
  const subject = normalizeReplySubject(input.subject);
  const voornaam =
    firstNameFrom(input.context?.leadNaam || input.fromName) || "daar";
  const agent = (input.agentNaam || "").trim() || "BatterijConcept";
  const thread = input.thread?.length
    ? input.thread
    : [
        {
          fromUs: false,
          fromName: input.fromName,
          subject: input.subject,
          body: input.bodyText,
        },
      ];
  const { latestKlant, history } = formatThreadForDraft(thread);
  const latestText = latestKlant || stripQuotedMailBody(input.bodyText);
  const intent = draftIntentHint(
    { subject: input.subject, bodyText: latestText },
    input.context
  );
  const facts = extractInboxFacts({
    fromEmail: input.fromEmail,
    subject: input.subject,
    bodyText: latestText,
  });

  if (!openaiInboxConfigured()) {
    return draftInboxReplyHeuristic({
      subject: input.subject,
      bodyText: latestText,
      voornaam,
      agent,
      ctx: input.context,
    });
  }

  const ctx = input.context;
  const afspraakLine = ctx?.afspraak
    ? [
        ctx.afspraak.soort || "Afspraak",
        formatDraftWhen(ctx.afspraak.startAt),
        ctx.afspraak.status,
        ctx.afspraak.adviseurNaam
          ? `adviseur ${ctx.afspraak.adviseurNaam}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const crmLines = [
    ctx?.leadNaam ? `Lead: ${ctx.leadNaam}` : "",
    ctx?.leadNumber ? `Leadnummer: ${ctx.leadNumber}` : "",
    ctx?.leadPlaats ? `Plaats: ${ctx.leadPlaats}` : "",
    ctx?.leadStatus ? `Leadstatus: ${ctx.leadStatus}` : "",
    ctx?.projectNummer ? `Project: ${ctx.projectNummer}` : "",
    ctx?.projectStatus ? `Projectstatus: ${ctx.projectStatus}` : "",
    afspraakLine ? `Gekoppelde afspraak: ${afspraakLine}` : "",
    ctx?.folder ? `Inboxmap: ${ctx.folder}` : "",
    ctx?.aiSummary ? `Interne samenvatting: ${ctx.aiSummary}` : "",
    facts.huisbezoek ? `Huisbezoek-signaal in tekst: ${facts.huisbezoek}` : "",
    intent ? `Gedetecteerde intentie: ${intent}` : "",
  ].filter(Boolean);

  const intentRegel =
    intent === "afzegging"
      ? "De klant zegt de afspraak/het huisbezoek af of wil er vanaf. Bevestig dat kort. Geen verkoop, geen nieuwe afspraak pushen tenzij ze er zelf om vragen."
      : intent === "geen_contact"
        ? "De klant wil geen contact meer. Bevestig dat we stoppen. Geen beloftes, geen upsell."
        : intent === "geen_interesse"
          ? "De klant heeft geen interesse. Respecteer dat, kort en beleefd."
          : intent === "annulering"
            ? "De klant vraagt om order/project te annuleren. Bevestig ontvangst, zeg dat we het dossier nakijken. Verzin geen kosten, termijnen of of het mag."
            : intent === "service"
              ? "Service/storing: erken hun melding in hun woorden. Zeg dat we het oppakken. Verzin geen diagnose of hersteldatum."
              : intent === "installatie"
                ? "Vraag over installatie/planning: antwoord alleen met wat in thread of CRM staat. Geen nieuwe datum verzinnen."
                : "Beantwoord hun concrete vraag. Alleen huisbezoek voorstellen als zij ernaar vragen of het een open oriëntatievraag is.";

  const client = getClient();
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: [
          "Je schrijft e-mailantwoorden voor BatterijConcept (thuisbatterijen, info@) aan een klant.",
          "Lever ALLEEN de mailbody. Geen onderwerpregel.",
          "",
          "LEES EERST. Je mag alleen reageren op wat de klant écht schreef, plus de CRM-feiten hieronder.",
          "Eerdere berichten in de thread zijn context: wat wij al beloofden, wat zij al vroegen. Weerspreek dat niet.",
          "",
          "VERBODEN:",
          "- Verzin geen prijzen, kortingen, datums, levertijden, technische specs, of of iets 'geregeld' is.",
          "- Geen generiek verkoopverhaal / huisbezoek-pitch als de klant iets anders vraagt (afzeggen, annuleren, storing, stop contact).",
          "- Geen feiten uit een andere klant of uit het niets. Ontbreekt info: zeg dat we het nakijken.",
          "- Geen HTML, emoji, intern jargon, het woord AI.",
          "",
          intentRegel,
          "",
          "TOON: je/jij, tenzij de klant u/uw gebruikt. Kort, helder, menselijk. Max ~120 woorden.",
          `- Begin met: Beste ${voornaam},`,
          `- Eindig met: Met vriendelijke groet,\\n${agent}`,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          crmLines.length
            ? `CRM-feiten (gebruik alleen als relevant):\n${crmLines.join("\n")}`
            : "",
          history
            ? `Eerdere berichten in deze conversatie (oud → nieuw):\n${history}`
            : "Geen eerdere berichten — alleen het laatste klantbericht.",
          "",
          "Nieuwste bericht van de klant (HIEROP antwoord je):",
          latestText || "(geen tekst)",
          "",
          "Schrijf nu het antwoord. Blijf bij deze thread.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });

  let body =
    completion.choices[0]?.message?.content?.trim() ||
    `Beste ${voornaam},\n\nBedankt voor je bericht.\n\nMet vriendelijke groet,\n${agent}`;

  body = body.replace(/^(onderwerp|subject|re)\s*:\s*.+\n+/i, "").trim();

  if (!/^Beste\s/i.test(body)) {
    body = `Beste ${voornaam},\n\n${body}`;
  }
  if (!/vriendelijke groet/i.test(body)) {
    body = `${body}\n\nMet vriendelijke groet,\n${agent}`;
  }

  return { subject, body };
}

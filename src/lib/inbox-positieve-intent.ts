/**
 * Positieve bel-intent uit inkomende INFO-mails.
 * OpenAI herkent/samenvat; lead krijgt mail_positief_* → vooraan in belqueue.
 */

import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logLeadEvent } from "@/lib/lead-events";
import { openaiInboxConfigured } from "@/lib/inbox-ai";

export type PositieveBelIntent = {
  positief: boolean;
  samenvatting: string;
  confidence: number;
  source: "ai" | "heuristic";
};

const POSITIEF_RE =
  /\b(jazeker|zeker|ja\s*graag|prima|akkoord|geïnteresseerd|geinteresseerd|interesse|wil\s+graag|bel\s+me|bel\s+maar|afspraak\s+(maken|plannen)|kom\s+(maar\s+)?langs|best\s+interess|goed\s+idee|doe\s+(maar|het)|top[,!]?\s*(bel|kom)|graag\s+(meer\s+)?info)\b/i;

const NEGATIEF_RE =
  /\b(geen\s*interesse|niet\s*geïnteresseerd|niet\s*interess|liever\s*niet|stop\s*(met\s*)?(mail|bellen)|geen\s*contact|afzeg|annul)\b/i;

export function detectPositieveBelIntentHeuristic(input: {
  subject: string;
  bodyText: string;
}): PositieveBelIntent {
  const text = `${input.subject}\n${input.bodyText}`;
  if (NEGATIEF_RE.test(text) && !POSITIEF_RE.test(text)) {
    return {
      positief: false,
      samenvatting: "",
      confidence: 0.7,
      source: "heuristic",
    };
  }
  if (POSITIEF_RE.test(text)) {
    const snip = text
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);
    return {
      positief: true,
      samenvatting: snip
        ? `Positieve reactie: “${snip}${text.trim().length > 140 ? "…" : ""}”`
        : "Positieve reactie op onze mail — bel deze lead.",
      confidence: 0.75,
      source: "heuristic",
    };
  }
  return {
    positief: false,
    samenvatting: "",
    confidence: 0.4,
    source: "heuristic",
  };
}

/**
 * OpenAI: is dit een positieve bel-intent (interesse / ja / wil afspraak)?
 * Bij ontbrekende key → heuristic.
 */
export async function detectPositieveBelIntent(input: {
  subject: string;
  bodyText: string;
}): Promise<PositieveBelIntent> {
  if (!openaiInboxConfigured()) {
    return detectPositieveBelIntentHeuristic(input);
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!.trim(),
    });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Je beoordeelt inkomende klantmails voor BatterijConcept (thuisbatterijen).
Bepaal of de klant POSITIEVE bel-intent toont: wil gebeld worden, heeft interesse, zegt ja op een uitnodiging, wil een adviesbezoek/afspraak, of reageert enthousiast op onze e-mail.

positief=true voorbeelden: "jazeker, best geïnteresseerd", "ja graag", "bel me maar", "prima, plan een afspraak", "ik wil meer info".
positief=false: neutrale vragen, service/storing, afzegging, geen interesse, spam, auto-replies.

Antwoord ALLEEN JSON:
{"positief":boolean,"samenvatting":"max 1 zin NL voor de beller","confidence":0-1}`,
        },
        {
          role: "user",
          content: [
            `Onderwerp: ${input.subject || "(geen)"}`,
            "",
            "Bericht:",
            (input.bodyText || "").slice(0, 4000),
          ].join("\n"),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    let parsed: {
      positief?: unknown;
      samenvatting?: unknown;
      confidence?: unknown;
    } = {};
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      return detectPositieveBelIntentHeuristic(input);
    }

    const positief = Boolean(parsed.positief);
    const samenvatting =
      typeof parsed.samenvatting === "string"
        ? parsed.samenvatting.trim().slice(0, 220)
        : "";
    const confidence = Number(parsed.confidence);
    return {
      positief,
      samenvatting:
        samenvatting ||
        (positief
          ? "Positieve mailreactie — bel deze lead met voorrang."
          : ""),
      confidence: Number.isFinite(confidence)
        ? Math.min(1, Math.max(0, confidence))
        : 0.6,
      source: "ai",
    };
  } catch (e) {
    console.error("detectPositieveBelIntent:", e);
    return detectPositieveBelIntentHeuristic(input);
  }
}

/**
 * Zet lead vooraan in de bellijst via mail_positief_* (+ prioriteit hoog).
 * Alleen als lead nog in belbare status zit.
 */
export async function markLeadPositieveBelIntent(
  sb: SupabaseClient,
  opts: {
    leadId: string;
    samenvatting: string;
    inboxMailId?: string | null;
    confidence?: number;
    source?: "ai" | "heuristic";
  }
): Promise<{ ok: boolean; skipped?: string }> {
  const { data: lead, error } = await sb
    .from("leads")
    .select("id, status, naam")
    .eq("id", opts.leadId)
    .maybeSingle();
  if (error || !lead) {
    return { ok: false, skipped: "lead_ontbreekt" };
  }

  const status = String(lead.status || "");
  const belbaar = new Set([
    "nieuw",
    "geen_contact",
    "vervolg_geen_contact",
    "afspraak_afgezegd_klant",
    "deur_niet_open",
  ]);
  if (!belbaar.has(status)) {
    return { ok: true, skipped: "niet_belbaar" };
  }

  const now = new Date().toISOString();
  const samenvatting =
    opts.samenvatting.trim().slice(0, 220) ||
    "Positieve mailreactie — bel met voorrang.";

  const patch: Record<string, unknown> = {
    mail_positief_at: now,
    mail_positief_samenvatting: samenvatting,
    prioriteit: "hoog",
    updated_at: now,
  };

  let { error: upErr } = await sb
    .from("leads")
    .update(patch)
    .eq("id", opts.leadId);

  if (
    upErr &&
    /mail_positief/i.test(upErr.message || "")
  ) {
    // Kolom nog niet gemigreerd → alleen prioriteit
    ({ error: upErr } = await sb
      .from("leads")
      .update({ prioriteit: "hoog", updated_at: now })
      .eq("id", opts.leadId));
  }

  if (upErr) {
    console.error("markLeadPositieveBelIntent:", upErr.message);
    return { ok: false, skipped: upErr.message };
  }

  try {
    await logLeadEvent({
      leadId: opts.leadId,
      soort: "status",
      titel: "Positieve mail → belprioriteit",
      detail: samenvatting,
      meta: {
        bron: "inbox_positieve_intent",
        inbox_mail_id: opts.inboxMailId || null,
        confidence: opts.confidence ?? null,
        source: opts.source || null,
      },
    });
  } catch {
    /* best-effort */
  }

  return { ok: true };
}

/** Detecteer + markeer na succesvolle inbox-insert. */
export async function maybeBoostLeadNaPositieveMail(
  sb: SupabaseClient,
  opts: {
    leadId: string | null | undefined;
    subject: string;
    bodyText: string;
    inboxMailId?: string | null;
  }
): Promise<PositieveBelIntent | null> {
  if (!opts.leadId) return null;
  const intent = await detectPositieveBelIntent({
    subject: opts.subject,
    bodyText: opts.bodyText,
  });
  if (!intent.positief || intent.confidence < 0.55) {
    return intent;
  }
  await markLeadPositieveBelIntent(sb, {
    leadId: opts.leadId,
    samenvatting: intent.samenvatting,
    inboxMailId: opts.inboxMailId,
    confidence: intent.confidence,
    source: intent.source,
  });
  return intent;
}

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireVoiceAiAccess } from "@/lib/voice-ai-auth";
import { parseSegments } from "@/lib/voice-ai";
import {
  STRAIGHT_LINE_STEPS,
  assignStraightLineMoments,
  straightLinePromptBlock,
  type StraightLineReview,
  type StraightLineStapReview,
} from "@/lib/straight-line-script";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/voice-ai/notes/[id]/review
 * Vergelijk transcript met Straight Line + momenten + letterlijke zinnen.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const gate = await requireVoiceAiAccess();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY ontbreekt" },
      { status: 503 }
    );
  }

  try {
    const { id } = await ctx.params;
    const sb = getSupabaseAdmin();
    const { data: note, error } = await sb
      .from("afspraak_voice_notes")
      .select("id, status, transcript_text, segments, afspraak_id")
      .eq("id", id)
      .maybeSingle();

    if (error || !note) {
      return NextResponse.json({ error: "Voice note niet gevonden" }, { status: 404 });
    }
    if (note.status !== "ready") {
      return NextResponse.json(
        { error: "Transcript is nog niet klaar" },
        { status: 400 }
      );
    }

    const { data: afspraak } = await sb
      .from("afspraken")
      .select("leads(naam), adviseurs!adviseur_id(naam)")
      .eq("id", note.afspraak_id)
      .maybeSingle();

    const lead = afspraak?.leads as { naam?: string } | null;
    const adv = afspraak?.adviseurs as { naam?: string } | null;
    const klant = lead?.naam || "Klant";
    const adviseur = adv?.naam || "Adviseur";

    const segments = parseSegments(note.segments);
    const transcript =
      segments.length > 0
        ? segments
            .map(
              (s) =>
                `[${s.start.toFixed(0)}s] ${s.speakerName}: ${s.text}`
            )
            .join("\n")
        : String(note.transcript_text || "");

    if (!transcript.trim()) {
      return NextResponse.json(
        { error: "Geen transcript om te beoordelen" },
        { status: 400 }
      );
    }

    const client = new OpenAI({ apiKey: key });
    const stepIds = STRAIGHT_LINE_STEPS.map((s) => s.id);
    const maxSec = segments.length
      ? Math.max(...segments.map((s) => s.end), 1)
      : 600;

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Je bent sales-coach bij Batterijconcept. Beoordeel een huisbezoek-transcript tegen het Straight Line script.
KRITIEKE stappen wegen zwaar: als die missen → score max 55.

Voor elke stap die zwak of gemist is:
- moment_sec: seconden WAAR dit in de Straight Line-volgorde had moeten komen. Gebruik tijden uit het transcript ([Xs]). ELKE gemiste stap krijgt een ANDER moment. Momenten lopen op (sfeer vroeg, close laat). Kies het moment vlak vóór of waar het onderwerp hoort — niet allemaal hetzelfde tijdstip.
- had_moeten_zeggen: 1-3 zinnen LETTERLIJK in het Nederlands (spreektaal)
- tip: korte coaching-uitleg in het Nederlands

Alles in het Nederlands. Nooit Engels.

Bij status "gedaan": moment_sec mag null, had_moeten_zeggen null.

Antwoord ALLEEN in JSON:
{
  "score": 0-100,
  "samenvatting": "2-3 zinnen NL",
  "stappen": [
    {
      "id": "<stap-id>",
      "titel": "<titel>",
      "status": "gedaan"|"zwak"|"gemist",
      "toelichting": "wat gebeurde er",
      "tip": "korte tip of null",
      "moment_sec": 123 of null,
      "had_moeten_zeggen": "letterlijke zin..." of null
    }
  ],
  "top_tips": ["max 5 tips"]
}
Beoordeel ELKE van: ${stepIds.join(", ")}.`,
        },
        {
          role: "user",
          content: `Adviseur: ${adviseur}
Klant: ${klant}

${straightLinePromptBlock()}

--- TRANSCRIPT ---
${transcript.slice(0, 28000)}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    let parsed: {
      score?: number;
      samenvatting?: string;
      stappen?: Array<Partial<StraightLineStapReview>>;
      top_tips?: string[];
    };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      return NextResponse.json(
        { error: "AI-antwoord kon niet gelezen worden" },
        { status: 500 }
      );
    }

    const byId = new Map(
      (parsed.stappen || []).map((s) => [s.id as string, s])
    );

    const stappenRaw: StraightLineStapReview[] = STRAIGHT_LINE_STEPS.map(
      (s) => {
        const hit = byId.get(s.id);
        const status =
          hit?.status === "gedaan" ||
          hit?.status === "zwak" ||
          hit?.status === "gemist"
            ? hit.status
            : ("gemist" as const);

        const moment_sec =
          hit?.moment_sec != null && Number.isFinite(Number(hit.moment_sec))
            ? Math.max(0, Math.min(maxSec, Number(hit.moment_sec)))
            : null;

        const had =
          typeof hit?.had_moeten_zeggen === "string" &&
          hit.had_moeten_zeggen.trim()
            ? hit.had_moeten_zeggen.trim()
            : status === "gedaan"
              ? null
              : hit?.tip || s.check;

        return {
          id: s.id,
          titel: hit?.titel || s.titel,
          status,
          kritiek: s.kritiek,
          toelichting: hit?.toelichting || "Niet herkend in transcript",
          tip: hit?.tip ?? (status === "gedaan" ? null : s.check),
          moment_sec,
          had_moeten_zeggen: had,
        };
      }
    );

    // Unieke, oplopende momenten op basis van keywords + volgorde
    const stappen = assignStraightLineMoments(
      stappenRaw,
      segments.map((s) => ({ start: s.start, end: s.end, text: s.text })),
      maxSec
    );

    let score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    const kritiekGemist = stappen.filter(
      (s) => s.kritiek && (s.status === "gemist" || s.status === "zwak")
    ).length;
    if (kritiekGemist >= 2) score = Math.min(score, 55);
    if (kritiekGemist >= 4) score = Math.min(score, 40);

    const review: StraightLineReview = {
      score,
      samenvatting: parsed.samenvatting || "",
      stappen,
      top_tips: Array.isArray(parsed.top_tips)
        ? parsed.top_tips.slice(0, 5).map(String)
        : [],
    };

    return NextResponse.json({ review });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "AI-review mislukt") },
      { status: 500 }
    );
  }
}

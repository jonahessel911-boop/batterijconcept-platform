import OpenAI from "openai";
import type {
  VoiceSpeakerRole,
  VoiceTranscriptSegment,
} from "@/lib/voice-ai";

function getClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY ontbreekt. Zet deze in Vercel / .env.local."
    );
  }
  return new OpenAI({ apiKey: key, timeout: 30 * 60 * 1000 });
}

export function openaiVoiceConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

type DiarizedSegment = {
  id?: string;
  start: number;
  end: number;
  text: string;
  speaker: string;
};

/**
 * Transcribeer met speaker-diarization (OpenAI gpt-4o-transcribe-diarize).
 * Map daarna A/B → adviseur/klant met de echte namen.
 */
export async function transcribeAfspraakVoice(opts: {
  file: File;
  klantNaam: string;
  adviseurNaam: string;
}): Promise<{
  text: string;
  durationSec: number | null;
  segments: VoiceTranscriptSegment[];
  speakerMap: Record<string, VoiceSpeakerRole>;
}> {
  const client = getClient();
  const klant = opts.klantNaam.trim() || "Klant";
  const adviseur = opts.adviseurNaam.trim() || "Adviseur";

  const raw = await client.audio.transcriptions.create({
    file: opts.file,
    model: "gpt-4o-transcribe-diarize",
    response_format: "diarized_json",
    chunking_strategy: "auto",
    language: "nl",
  });

  const diarized = raw as {
    text?: string;
    duration?: number;
    segments?: DiarizedSegment[];
  };

  const rawSegments = (diarized.segments || [])
    .map((s, i) => ({
      id: s.id || `seg_${i}`,
      start: Number(s.start) || 0,
      end: Number(s.end) || Number(s.start) || 0,
      text: String(s.text || "").trim(),
      speaker: String(s.speaker || "A").trim() || "A",
    }))
    .filter((s) => s.text.length > 0);

  const speakerMap = await mapSpeakersToRoles({
    client,
    segments: rawSegments,
    klantNaam: klant,
    adviseurNaam: adviseur,
  });

  let segments: VoiceTranscriptSegment[] = rawSegments.map((s) => {
    const role = speakerMap[s.speaker] || "onbekend";
    return {
      id: s.id,
      start: s.start,
      end: s.end,
      text: s.text,
      speaker: s.speaker,
      role,
      speakerName:
        role === "adviseur" ? adviseur : role === "klant" ? klant : s.speaker,
    };
  });

  // Diarize-model glijdt soms naar Engels — forceer NL na-af
  segments = await forceDutchSegments(client, segments);

  const text = segments.map((s) => `${s.speakerName}: ${s.text}`).join("\n");

  return {
    text,
    durationSec:
      typeof diarized.duration === "number" && Number.isFinite(diarized.duration)
        ? diarized.duration
        : segments.length
          ? Math.max(...segments.map((s) => s.end))
          : null,
    segments,
    speakerMap,
  };
}

/** Heuristiek: segment lijkt Engels i.p.v. Nederlands. */
export function looksEnglish(text: string): boolean {
  const t = text.toLowerCase();
  if (!t.trim()) return false;
  const enHits = (
    t.match(
      /\b(the|and|you|that|with|this|have|from|they|what|about|would|could|should|yeah|actually|energy|person|umbrell?a|telemarketer|popular|deliver|here|main|things|these|sit|by|for|is|uh|um)\b/g
    ) || []
  ).length;
  const nlHits = (
    t.match(
      /\b(het|een|van|dat|niet|voor|met|zijn|deze|naar|ook|maar|wat|als|bij|nog|wel|dus|er|ze|we|je|ik|jij|u|de|en|in|op|te|die|dan|om|aan|kan|zijn|worden|batterij|warmtefonds|zonnepanelen)\b/g
    ) || []
  ).length;
  // Duidelijk Engels, of veel Engelse stopwoorden t.o.v. NL
  if (enHits >= 3 && enHits > nlHits) return true;
  if (/\b(yeah|actually|telemarketer|umbrell?a)\b/i.test(t) && nlHits < 2) {
    return true;
  }
  return false;
}

async function forceDutchSegments(
  client: OpenAI,
  segments: VoiceTranscriptSegment[]
): Promise<VoiceTranscriptSegment[]> {
  const englishIdx = segments
    .map((s, i) => (looksEnglish(s.text) ? i : -1))
    .filter((i) => i >= 0);
  if (englishIdx.length === 0) return segments;

  // Batch in chunks van max 25
  const out = segments.map((s) => ({ ...s }));
  for (let offset = 0; offset < englishIdx.length; offset += 25) {
    const batch = englishIdx.slice(offset, offset + 25);
    const payload = batch.map((i) => ({
      i,
      text: segments[i].text,
    }));
    try {
      const completion = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Je corrigeert transcript-fragmenten van een Nederlands huisbezoek (thuisbatterijen).
Sommige regels zijn per ongeluk in het Engels getranscribeerd, terwijl er Nederlands werd gesproken.
Zet ELKE regel om naar natuurlijk Nederlands (spreektaal), zelfde betekenis. Verzin niets nieuws.
Antwoord ALLEEN JSON: {"items":[{"i":0,"text":"..."},...]}`,
          },
          {
            role: "user",
            content: JSON.stringify({ items: payload }),
          },
        ],
      });
      const raw = completion.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(raw) as {
        items?: { i?: number; text?: string }[];
      };
      for (const item of parsed.items || []) {
        const i = Number(item.i);
        const text = String(item.text || "").trim();
        if (!Number.isFinite(i) || !text || !out[i]) continue;
        out[i] = { ...out[i], text };
      }
    } catch {
      /* best-effort: laat Engels staan als correctie faalt */
    }
  }
  return out;
}

async function mapSpeakersToRoles(opts: {
  client: OpenAI;
  segments: DiarizedSegment[];
  klantNaam: string;
  adviseurNaam: string;
}): Promise<Record<string, VoiceSpeakerRole>> {
  const speakers = [...new Set(opts.segments.map((s) => s.speaker))];
  if (speakers.length === 0) return {};
  if (speakers.length === 1) {
    // Eén stem: meestal de adviseur (opname vanaf diens telefoon)
    return { [speakers[0]]: "adviseur" };
  }

  const sample = opts.segments
    .slice(0, 40)
    .map(
      (s) =>
        `[${s.speaker} ${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`
    )
    .join("\n")
    .slice(0, 6000);

  try {
    const completion = await opts.client.chat.completions.create({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Je labelt speakers in een Nederlands huisbezoek-gesprek over thuisbatterijen.
Speakers zijn gelabeld met letters (A, B, …).
Map elke letter naar exact "adviseur" of "klant".
Adviseur (${opts.adviseurNaam}): verkoopt, legt producten/prijzen/subsidie uit, stelt vragen over verbruik.
Klant (${opts.klantNaam}): woont op locatie, beantwoordt persoonlijke vragen, twijfelt, vraagt naar prijs.
Antwoord ALLEEN JSON object: {"A":"adviseur","B":"klant",...}`,
        },
        {
          role: "user",
          content: `Speakers: ${speakers.join(", ")}\n\nFragment:\n${sample}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const out: Record<string, VoiceSpeakerRole> = {};
    for (const sp of speakers) {
      const v = parsed[sp];
      if (v === "adviseur" || v === "klant") out[sp] = v;
      else out[sp] = "onbekend";
    }
    // Minstens één adviseur + één klant als we twee+ speakers hebben
    const roles = Object.values(out);
    if (
      speakers.length >= 2 &&
      !roles.includes("adviseur") &&
      !roles.includes("klant")
    ) {
      out[speakers[0]] = "adviseur";
      out[speakers[1]] = "klant";
    } else if (speakers.length >= 2 && !roles.includes("adviseur")) {
      const other = speakers.find((s) => out[s] !== "klant") || speakers[0];
      out[other] = "adviseur";
    } else if (speakers.length >= 2 && !roles.includes("klant")) {
      const other = speakers.find((s) => out[s] !== "adviseur") || speakers[1];
      out[other] = "klant";
    }
    return out;
  } catch {
    const out: Record<string, VoiceSpeakerRole> = {};
    speakers.forEach((s, i) => {
      out[s] = i === 0 ? "adviseur" : i === 1 ? "klant" : "onbekend";
    });
    return out;
  }
}

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createHash } from "crypto";
import { errMessage } from "@/lib/errors";
import { requireVoiceAiAccess } from "@/lib/voice-ai-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ttsVoiceForAdviseur } from "@/lib/straight-line-script";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "voice-notes";

/**
 * POST /api/voice-ai/tts
 * body: { text, adviseur_naam?, voice_note_id? }
 *
 * Genereert TTS van de coaching-zin.
 * Probeert eerst ElevenLabs voice-clone van de opname (als ELEVENLABS_API_KEY),
 * anders OpenAI TTS met een vaste stem per adviseur.
 */
export async function POST(req: NextRequest) {
  const gate = await requireVoiceAiAccess();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const body = (await req.json()) as {
      text?: string;
      adviseur_naam?: string;
      voice_note_id?: string;
    };
    let text = (body.text || "").trim().slice(0, 1200);
    if (!text) {
      return NextResponse.json({ error: "Geen tekst" }, { status: 400 });
    }
    // TTS altijd NL uitspreken
    text = text.replace(/\s+/g, " ").trim();

    const adviseur = (body.adviseur_naam || "Adviseur").trim();
    const cacheKey = createHash("sha256")
      .update(`v2|${adviseur}|${body.voice_note_id || ""}|${text}`)
      .digest("hex")
      .slice(0, 32);
    const storagePath = `tts-cache/${cacheKey}.mp3`;

    const sb = getSupabaseAdmin();
    const existing = await sb.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
    if (existing.data?.signedUrl) {
      // Check of bestand echt bestaat
      const head = await fetch(existing.data.signedUrl, { method: "HEAD" });
      if (head.ok) {
        return NextResponse.json({
          url: existing.data.signedUrl,
          provider: "cache",
        });
      }
    }

    let audio: Buffer;
    let provider: string;

    const elevenKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (elevenKey && body.voice_note_id) {
      const cloned = await tryElevenLabsClone({
        apiKey: elevenKey,
        sb,
        voiceNoteId: body.voice_note_id,
        text,
        adviseur,
      });
      if (cloned) {
        audio = cloned;
        provider = "elevenlabs-clone";
      } else {
        audio = await openaiTts(text, adviseur);
        provider = "openai";
      }
    } else {
      audio = await openaiTts(text, adviseur);
      provider = "openai";
    }

    await sb.storage.from(BUCKET).upload(storagePath, audio, {
      contentType: "audio/mpeg",
      upsert: true,
    });

    const signed = await sb.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 60 * 60 * 6);

    return NextResponse.json({
      url: signed.data?.signedUrl || null,
      provider,
      // Fallback: data URL als signed faalt
      ...(signed.data?.signedUrl
        ? {}
        : {
            dataUrl: `data:audio/mpeg;base64,${audio.toString("base64")}`,
          }),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "TTS mislukt") },
      { status: 500 }
    );
  }
}

async function openaiTts(text: string, adviseur: string): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY ontbreekt");
  const client = new OpenAI({ apiKey: key });
  const voice = ttsVoiceForAdviseur(adviseur) as
    | "alloy"
    | "echo"
    | "fable"
    | "onyx"
    | "nova"
    | "shimmer";

  const speech = await client.audio.speech.create({
    model: "tts-1-hd",
    voice,
    input: text,
    response_format: "mp3",
    speed: 1,
  });
  return Buffer.from(await speech.arrayBuffer());
}

async function tryElevenLabsClone(opts: {
  apiKey: string;
  sb: ReturnType<typeof getSupabaseAdmin>;
  voiceNoteId: string;
  text: string;
  adviseur: string;
}): Promise<Buffer | null> {
  try {
    const { data: note } = await opts.sb
      .from("afspraak_voice_notes")
      .select("storage_path")
      .eq("id", opts.voiceNoteId)
      .maybeSingle();
    if (!note?.storage_path) return null;

    const { data: file, error } = await opts.sb.storage
      .from(BUCKET)
      .download(note.storage_path as string);
    if (error || !file) return null;

    const sampleBuf = Buffer.from(await file.arrayBuffer());
    // Max ~ sample size for clone (keep first ~2MB)
    const sample = sampleBuf.subarray(0, Math.min(sampleBuf.length, 2_000_000));

    const voiceName = `bc-${opts.adviseur.slice(0, 20)}-${opts.voiceNoteId.slice(0, 8)}`;

    const form = new FormData();
    form.append("name", voiceName);
    form.append(
      "files",
      new Blob([sample], { type: "audio/mpeg" }),
      "sample.mp3"
    );
    form.append("description", "Batterijconcept Voice AI coaching clone");

    const addRes = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: { "xi-api-key": opts.apiKey },
      body: form,
    });
    if (!addRes.ok) return null;
    const added = (await addRes.json()) as { voice_id?: string };
    const voiceId = added.voice_id;
    if (!voiceId) return null;

    try {
      const ttsRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": opts.apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: opts.text,
            model_id: "eleven_multilingual_v2",
          }),
        }
      );
      if (!ttsRes.ok) return null;
      return Buffer.from(await ttsRes.arrayBuffer());
    } finally {
      // Ruim tijdelijke clone op
      await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
        method: "DELETE",
        headers: { "xi-api-key": opts.apiKey },
      }).catch(() => null);
    }
  } catch {
    return null;
  }
}

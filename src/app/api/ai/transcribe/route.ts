import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import { requireAiAdmin } from "@/lib/ai/require-admin";
import { transcribeAudio } from "@/lib/ai/chat";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST /api/ai/transcribe — Whisper (admin-only), multipart field "audio" */
export async function POST(req: NextRequest) {
  const gate = await requireAiAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) {
      return NextResponse.json(
        { error: "Geen audio ontvangen" },
        { status: 400 }
      );
    }
    if (audio.size > 25 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Audio te groot (max 25 MB)" },
        { status: 400 }
      );
    }

    const filename =
      audio instanceof File && audio.name
        ? audio.name
        : `whisper-${Date.now()}.webm`;

    const text = await transcribeAudio(audio, filename);
    if (!text) {
      return NextResponse.json(
        { error: "Geen spraak herkend" },
        { status: 422 }
      );
    }
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Transcriptie mislukt") },
      { status: 500 }
    );
  }
}

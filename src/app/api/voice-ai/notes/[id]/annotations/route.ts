import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireVoiceAiAccess } from "@/lib/voice-ai-auth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/voice-ai/notes/[id]/annotations
 * body: { start_sec, end_sec?, segment_id?, quote_text?, notitie }
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireVoiceAiAccess();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const { id: voiceNoteId } = await ctx.params;
    const body = (await req.json()) as {
      start_sec?: number;
      end_sec?: number | null;
      segment_id?: string | null;
      quote_text?: string | null;
      notitie?: string;
    };

    const notitie = (body.notitie || "").trim();
    if (!notitie) {
      return NextResponse.json({ error: "Notitie is verplicht" }, { status: 400 });
    }

    const start_sec = Number(body.start_sec);
    if (!Number.isFinite(start_sec) || start_sec < 0) {
      return NextResponse.json({ error: "Ongeldig tijdstip" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const { data: note } = await sb
      .from("afspraak_voice_notes")
      .select("id")
      .eq("id", voiceNoteId)
      .maybeSingle();
    if (!note) {
      return NextResponse.json({ error: "Voice note niet gevonden" }, { status: 404 });
    }

    const { data: inserted, error } = await sb
      .from("afspraak_voice_annotations")
      .insert({
        voice_note_id: voiceNoteId,
        segment_id: body.segment_id || null,
        start_sec,
        end_sec:
          body.end_sec == null || !Number.isFinite(Number(body.end_sec))
            ? null
            : Number(body.end_sec),
        quote_text: (body.quote_text || "").trim() || null,
        notitie,
        created_by_id: gate.session.adviseurId || null,
      })
      .select(
        "id, voice_note_id, segment_id, start_sec, end_sec, quote_text, notitie, created_by_id, created_at"
      )
      .single();

    if (error || !inserted) {
      return NextResponse.json(
        { error: error?.message || "Opslaan mislukt" },
        { status: 500 }
      );
    }

    return NextResponse.json({ annotation: inserted });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Opslaan mislukt") },
      { status: 500 }
    );
  }
}

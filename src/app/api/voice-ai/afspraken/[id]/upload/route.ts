import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireVoiceUploadForAfspraak } from "@/lib/voice-ai-auth";
import {
  createVoiceSignedUpload,
  downloadVoiceNoteBuffer,
  validateVoiceMeta,
  VOICE_NOTES_BUCKET,
} from "@/lib/voice-ai-storage";
import {
  openaiVoiceConfigured,
  transcribeAfspraakVoice,
} from "@/lib/voice-ai-transcribe";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/voice-ai/afspraken/[id]/upload
 *
 * Stap 1 (JSON): { action: "prepare", bestandsnaam, content_type, size }
 *   → signed upload URL + note_id (status=transcribing)
 *
 * Stap 2 (JSON): { action: "transcribe", note_id }
 *   → haalt audio uit Storage en transcribeert (geen FormData door Next)
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id: afspraakId } = await ctx.params;
  const gate = await requireVoiceUploadForAfspraak(afspraakId);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (!openaiVoiceConfigured()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY ontbreekt" },
      { status: 503 }
    );
  }

  const sb = getSupabaseAdmin();

  try {
    const body = (await req.json()) as {
      action?: string;
      bestandsnaam?: string;
      content_type?: string;
      size?: number;
      note_id?: string;
    };

    const action = body.action || "prepare";

    if (action === "prepare") {
      const meta = validateVoiceMeta({
        bestandsnaam: body.bestandsnaam || "opname.webm",
        content_type: body.content_type || "audio/webm",
        size: Number(body.size) || 0,
      });
      if (!meta.ok) {
        return NextResponse.json(
          { error: meta.error },
          { status: meta.status }
        );
      }

      const { data: afspraak, error: aErr } = await sb
        .from("afspraken")
        .select("id")
        .eq("id", afspraakId)
        .maybeSingle();
      if (aErr || !afspraak) {
        return NextResponse.json(
          { error: "Afspraak niet gevonden" },
          { status: 404 }
        );
      }

      const slot = await createVoiceSignedUpload(
        sb,
        afspraakId,
        meta.bestandsnaam,
        body.content_type || "audio/webm"
      );
      if ("error" in slot) {
        return NextResponse.json(
          { error: slot.error, detail: slot.detail },
          { status: slot.status }
        );
      }

      const { data: inserted, error: insErr } = await sb
        .from("afspraak_voice_notes")
        .insert({
          afspraak_id: afspraakId,
          storage_path: slot.storage_path,
          bestandsnaam: slot.bestandsnaam,
          content_type: slot.content_type,
          status: "transcribing",
          uploaded_by_id: gate.session.adviseurId || null,
        })
        .select("id")
        .single();

      if (insErr || !inserted) {
        return NextResponse.json(
          { error: insErr?.message || "Opslaan mislukt" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        note_id: inserted.id,
        storage_path: slot.storage_path,
        signedUrl: slot.signedUrl,
        token: slot.token,
        bucket: VOICE_NOTES_BUCKET,
        bestandsnaam: slot.bestandsnaam,
        content_type: slot.content_type,
      });
    }

    if (action === "transcribe") {
      const noteId = (body.note_id || "").trim();
      if (!noteId) {
        return NextResponse.json({ error: "note_id ontbreekt" }, { status: 400 });
      }

      const { data: note, error: nErr } = await sb
        .from("afspraak_voice_notes")
        .select("*")
        .eq("id", noteId)
        .eq("afspraak_id", afspraakId)
        .maybeSingle();

      if (nErr || !note) {
        return NextResponse.json(
          { error: "Voice note niet gevonden" },
          { status: 404 }
        );
      }

      const { data: afspraak } = await sb
        .from("afspraken")
        .select(
          "id, leads(naam), adviseurs!adviseur_id(naam)"
        )
        .eq("id", afspraakId)
        .maybeSingle();

      const lead = afspraak?.leads as { naam?: string } | null;
      const adv = afspraak?.adviseurs as { naam?: string } | null;
      const klantNaam = lead?.naam || "Klant";
      const adviseurNaam = adv?.naam || "Adviseur";

      const buffer = await downloadVoiceNoteBuffer(
        sb,
        note.storage_path as string
      );
      if (!buffer || buffer.length === 0) {
        await sb
          .from("afspraak_voice_notes")
          .update({
            status: "error",
            error_message: "Audio niet gevonden in storage",
            updated_at: new Date().toISOString(),
          })
          .eq("id", noteId);
        return NextResponse.json(
          { error: "Audio niet gevonden — upload opnieuw" },
          { status: 400 }
        );
      }

      const filename =
        (note.bestandsnaam as string) ||
        `voice-${Date.now()}.webm`;
      const contentType =
        (note.content_type as string) || "audio/webm";
      const file = new File([new Uint8Array(buffer)], filename, {
        type: contentType,
      });

      try {
        const result = await transcribeAfspraakVoice({
          file,
          klantNaam,
          adviseurNaam,
        });

        const { data: updated, error: upErr } = await sb
          .from("afspraak_voice_notes")
          .update({
            status: "ready",
            transcript_text: result.text,
            segments: result.segments,
            speaker_map: result.speakerMap,
            duration_sec: result.durationSec,
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", noteId)
          .select("*")
          .single();

        if (upErr) {
          return NextResponse.json(
            { error: upErr.message, noteId },
            { status: 500 }
          );
        }

        return NextResponse.json({
          note: updated,
          klant_naam: klantNaam,
          adviseur_naam: adviseurNaam,
        });
      } catch (e) {
        const msg = errMessage(e, "Transcriptie mislukt");
        await sb
          .from("afspraak_voice_notes")
          .update({
            status: "error",
            error_message: msg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", noteId);
        return NextResponse.json({ error: msg, noteId }, { status: 500 });
      }
    }

    return NextResponse.json(
      { error: "Onbekende action (prepare | transcribe)" },
      { status: 400 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Upload mislukt") },
      { status: 500 }
    );
  }
}

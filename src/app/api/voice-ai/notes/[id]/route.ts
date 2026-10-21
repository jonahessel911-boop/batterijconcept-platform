import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireVoiceAiAccess } from "@/lib/voice-ai-auth";
import { signedVoiceNoteUrl } from "@/lib/voice-ai-storage";
import { parseSegments, type VoiceAnnotation } from "@/lib/voice-ai";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/voice-ai/notes/[id] — note + signed audio + annotations */
export async function GET(_req: Request, ctx: Ctx) {
  const gate = await requireVoiceAiAccess();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const sb = getSupabaseAdmin();

    const { data: note, error } = await sb
      .from("afspraak_voice_notes")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !note) {
      return NextResponse.json({ error: "Voice note niet gevonden" }, { status: 404 });
    }

    const { data: afspraak } = await sb
      .from("afspraken")
      .select(
        "id, start_at, soort, status, leads(naam), adviseurs!adviseur_id(naam)"
      )
      .eq("id", note.afspraak_id)
      .maybeSingle();

    const { data: anns } = await sb
      .from("afspraak_voice_annotations")
      .select(
        "id, voice_note_id, segment_id, start_sec, end_sec, quote_text, notitie, created_by_id, created_at"
      )
      .eq("voice_note_id", id)
      .order("start_sec", { ascending: true });

    const creatorIds = [
      ...new Set(
        (anns || [])
          .map((a) => a.created_by_id as string | null)
          .filter((x): x is string => Boolean(x))
      ),
    ];
    const creatorNames = new Map<string, string>();
    if (creatorIds.length > 0) {
      const { data: creators } = await sb
        .from("adviseurs")
        .select("id, naam")
        .in("id", creatorIds);
      for (const c of creators || []) {
        creatorNames.set(c.id as string, (c.naam as string) || "Coach");
      }
    }

    const audioUrl = await signedVoiceNoteUrl(sb, note.storage_path as string);

    const lead = afspraak?.leads as { naam?: string } | null;
    const adv = afspraak?.adviseurs as { naam?: string } | null;

    const annotations: VoiceAnnotation[] = (anns || []).map((a) => {
      const cid = (a.created_by_id as string | null) ?? null;
      return {
        id: a.id as string,
        voice_note_id: a.voice_note_id as string,
        segment_id: (a.segment_id as string | null) ?? null,
        start_sec: Number(a.start_sec) || 0,
        end_sec: a.end_sec == null ? null : Number(a.end_sec),
        quote_text: (a.quote_text as string | null) ?? null,
        notitie: a.notitie as string,
        created_by_id: cid,
        created_at: a.created_at as string,
        created_by: cid && creatorNames.has(cid)
          ? { naam: creatorNames.get(cid)! }
          : null,
      };
    });

    return NextResponse.json({
      note: {
        ...note,
        segments: parseSegments(note.segments),
      },
      audioUrl,
      klant_naam: lead?.naam || "Klant",
      adviseur_naam: adv?.naam || "Adviseur",
      afspraak: afspraak
        ? {
            id: afspraak.id,
            start_at: afspraak.start_at,
            soort: afspraak.soort,
            status: afspraak.status,
          }
        : null,
      annotations,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Laden mislukt") },
      { status: 500 }
    );
  }
}

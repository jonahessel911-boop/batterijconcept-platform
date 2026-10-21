import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { normalizeAfspraakSoort } from "@/lib/afspraak-soort";
import { requireVoiceAiAccess } from "@/lib/voice-ai-auth";
import type { VoiceAfspraakRow, VoiceNoteStatus } from "@/lib/voice-ai";

export const runtime = "nodejs";

function isTarikNaam(naam: string | null | undefined): boolean {
  const n = (naam || "").trim().toLowerCase();
  return n === "tarik" || n.startsWith("tarik ");
}

/**
 * GET /api/voice-ai/afspraken?days=90&q=
 * Alleen nieuwe fysieke huisbezoeken (soort=nieuw). Geen vervolg. Tarik uitgesloten.
 */
export async function GET(req: NextRequest) {
  const gate = await requireVoiceAiAccess();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const days = Math.min(
      365,
      Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 30)
    );
    const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

    // Van vandaag terug tot N dagen (einde vandaag = cutoff toekomst)
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const since = new Date(now);
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const sb = getSupabaseAdmin();
    const { data: afspraken, error } = await sb
      .from("afspraken")
      .select(
        "id, start_at, end_at, status, soort, lead_id, adviseur_id, leads(naam), adviseurs!adviseur_id(naam)"
      )
      .gte("start_at", since.toISOString())
      .lte("start_at", endOfToday.toISOString())
      .neq("status", "geannuleerd")
      .order("start_at", { ascending: false })
      .limit(800);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const huisbezoeken = (afspraken || []).filter((a) => {
      // Alleen eerste huisbezoek — geen vervolg_fysiek / bel / telefonisch
      if (normalizeAfspraakSoort(a.soort as string | null) !== "nieuw") {
        return false;
      }
      const adv = a.adviseurs as { naam?: string } | null;
      if (isTarikNaam(adv?.naam)) return false;
      return true;
    });

    const ids = huisbezoeken.map((a) => a.id as string);
    const noteByAfspraak = new Map<
      string,
      {
        id: string;
        status: VoiceNoteStatus;
        created_at: string;
        duration_sec: number | null;
        annotation_count: number;
      }
    >();

    if (ids.length > 0) {
      const { data: notes } = await sb
        .from("afspraak_voice_notes")
        .select("id, afspraak_id, status, created_at, duration_sec")
        .in("afspraak_id", ids)
        .order("created_at", { ascending: false });

      const noteIds: string[] = [];
      for (const n of notes || []) {
        const aid = n.afspraak_id as string;
        if (noteByAfspraak.has(aid)) continue;
        noteByAfspraak.set(aid, {
          id: n.id as string,
          status: n.status as VoiceNoteStatus,
          created_at: n.created_at as string,
          duration_sec:
            n.duration_sec == null ? null : Number(n.duration_sec),
          annotation_count: 0,
        });
        noteIds.push(n.id as string);
      }

      if (noteIds.length > 0) {
        const { data: anns } = await sb
          .from("afspraak_voice_annotations")
          .select("voice_note_id")
          .in("voice_note_id", noteIds);
        const counts = new Map<string, number>();
        for (const a of anns || []) {
          const id = a.voice_note_id as string;
          counts.set(id, (counts.get(id) || 0) + 1);
        }
        for (const note of noteByAfspraak.values()) {
          note.annotation_count = counts.get(note.id) || 0;
        }
      }
    }

    let rows: VoiceAfspraakRow[] = huisbezoeken.map((a) => {
      const lead = a.leads as { naam?: string } | null;
      const adv = a.adviseurs as { naam?: string } | null;
      return {
        id: a.id as string,
        start_at: a.start_at as string,
        end_at: a.end_at as string,
        status: a.status as string,
        soort: (a.soort as string | null) ?? null,
        lead_id: a.lead_id as string,
        adviseur_id: a.adviseur_id as string,
        klant_naam: lead?.naam || "Onbekend",
        adviseur_naam: adv?.naam || "Onbekend",
        voice_note: noteByAfspraak.get(a.id as string) || null,
      };
    });

    if (q) {
      rows = rows.filter(
        (r) =>
          r.klant_naam.toLowerCase().includes(q) ||
          r.adviseur_naam.toLowerCase().includes(q)
      );
    }

    return NextResponse.json({ afspraken: rows, days });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Laden mislukt") },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateAvailableSlots } from "@/lib/slots";

export const runtime = "nodejs";

/** GET /api/adviseurs — lijst + optioneel ?adviseur_id= voor slots */
export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const adviseurId = req.nextUrl.searchParams.get("adviseur_id");

    const { data: adviseurs, error } = await sb
      .from("adviseurs")
      .select("*")
      .eq("actief", true)
      .order("naam");

    if (error) throw error;

    if (!adviseurId) {
      return NextResponse.json({ adviseurs: adviseurs || [] });
    }

    const adviseur = (adviseurs || []).find((a) => a.id === adviseurId);
    if (!adviseur) {
      return NextResponse.json({ error: "Adviseur niet gevonden" }, { status: 404 });
    }

    const { data: busy } = await sb
      .from("afspraken")
      .select("start_at, end_at")
      .eq("adviseur_id", adviseurId)
      .neq("status", "geannuleerd");

    const startHour = parseInt(String(adviseur.werktijd_start).split(":")[0], 10);
    const endHour = parseInt(String(adviseur.werktijd_eind).split(":")[0], 10);

    const slots = generateAvailableSlots({
      busy: busy || [],
      startHour: Number.isFinite(startHour) ? startHour : 9,
      endHour: Number.isFinite(endHour) ? endHour : 17,
    }).map((s) => ({
      start_at: s.start.toISOString(),
      end_at: s.end.toISOString(),
    }));

    return NextResponse.json({ adviseurs: adviseurs || [], slots });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

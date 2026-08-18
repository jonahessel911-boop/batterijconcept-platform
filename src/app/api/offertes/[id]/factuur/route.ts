import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ensureBtwDraftFactuur } from "@/lib/ensure-btw-factuur";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * POST /api/offertes/[id]/factuur
 * Zorgt dat er een concept BTW-factuur bestaat voor een ondertekende offerte.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: offerte, error } = await sb
      .from("offertes")
      .select(
        "id, lead_id, offerte_nummer, status, btw_bedrag, subtotaal_ex_btw, totaal_inc_btw"
      )
      .eq("id", id)
      .single();

    if (error || !offerte) {
      return NextResponse.json({ error: "Offerte niet gevonden" }, { status: 404 });
    }
    if (offerte.status !== "ondertekend") {
      return NextResponse.json(
        { error: "Alleen ondertekende offertes krijgen een BTW-factuur" },
        { status: 409 }
      );
    }

    const { data: project } = await sb
      .from("projecten")
      .select("id")
      .eq("offerte_id", id)
      .maybeSingle();

    const factuur = await ensureBtwDraftFactuur(sb, {
      offerteId: offerte.id,
      leadId: offerte.lead_id,
      projectId: project?.id || null,
      offerteNummer: offerte.offerte_nummer,
      btwBedrag: Number(offerte.btw_bedrag) || 0,
      subtotaalExBtw: Number(offerte.subtotaal_ex_btw) || 0,
      totaalIncBtw: Number(offerte.totaal_inc_btw) || 0,
    });

    if (!factuur) {
      return NextResponse.json(
        { error: "BTW-factuur aanmaken mislukt" },
        { status: 500 }
      );
    }

    return NextResponse.json({ factuur });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

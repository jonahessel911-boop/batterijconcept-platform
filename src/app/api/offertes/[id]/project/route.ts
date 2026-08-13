import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ensureProjectForOfferte } from "@/lib/ensure-project";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * POST /api/offertes/[id]/project
 * Zorgt dat er een project bestaat voor een ondertekende offerte.
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
      .select("id, lead_id, offerte_nummer, titel, status, leads(naam)")
      .eq("id", id)
      .single();

    if (error || !offerte) {
      return NextResponse.json({ error: "Offerte niet gevonden" }, { status: 404 });
    }
    if (offerte.status !== "ondertekend") {
      return NextResponse.json(
        { error: "Alleen ondertekende offertes krijgen een project" },
        { status: 409 }
      );
    }

    const leads = offerte.leads as { naam?: string } | null;
    const project = await ensureProjectForOfferte(sb, {
      offerteId: offerte.id,
      leadId: offerte.lead_id,
      offerteNummer: offerte.offerte_nummer,
      titel: offerte.titel,
      klantNaam: leads?.naam || null,
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project aanmaken mislukt — check of migrate-project-status.sql is gedraaid" },
        { status: 500 }
      );
    }

    return NextResponse.json({ project });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

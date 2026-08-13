import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { syncProjectServiceStatus } from "@/lib/service-verzoek";

export const runtime = "nodejs";

/**
 * PATCH /api/service-verzoeken/[id]
 * Update interne notitie en/of markeer als afgehandeld.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    interne_notitie?: string;
    status?: "open" | "afgehandeld";
    omschrijving?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: current, error: curErr } = await sb
      .from("service_verzoeken")
      .select("id, project_id, status")
      .eq("id", id)
      .single();

    if (curErr || !current) {
      return NextResponse.json({ error: "Verzoek niet gevonden" }, { status: 404 });
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.interne_notitie === "string") {
      patch.interne_notitie = body.interne_notitie.trim() || null;
    }
    if (typeof body.omschrijving === "string") {
      patch.omschrijving = body.omschrijving.trim() || null;
    }
    if (body.status === "afgehandeld" || body.status === "open") {
      patch.status = body.status;
      patch.afgehandeld_op =
        body.status === "afgehandeld" ? new Date().toISOString() : null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
    }

    const { data, error } = await sb
      .from("service_verzoeken")
      .update(patch)
      .eq("id", id)
      .select(
        "*, leads(naam, lead_number), projecten(id, project_nummer, titel, status)"
      )
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Bijwerken mislukt", detail: error?.message },
        { status: 500 }
      );
    }

    await syncProjectServiceStatus(sb, current.project_id);

    const { data: refreshed } = await sb
      .from("service_verzoeken")
      .select(
        "*, leads(naam, lead_number), projecten(id, project_nummer, titel, status)"
      )
      .eq("id", id)
      .single();

    return NextResponse.json({ verzoek: refreshed || data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * GET /api/installatie-partners/[id]/agenda
 * Alle projecten (schouw/installatie) van deze installateur voor de agenda.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: partner, error: pErr } = await sb
      .from("installatie_partners")
      .select("id, naam, email, telefoon, actief")
      .eq("id", id)
      .single();

    if (pErr || !partner) {
      return NextResponse.json(
        { error: "Installatiepartner niet gevonden" },
        { status: 404 }
      );
    }

    const { data: orders, error } = await sb
      .from("projecten")
      .select(
        "id, project_nummer, titel, status, schouw_at, schouw_jaar, schouw_week, schouw_notities, installatie_at, installatie_notities, installatie_partner_id, monteur, startdatum, opleverdatum, created_at, leads(naam, telefoon, email, postcode, huisnummer, toevoeging, straat, plaats, lead_number), installatie_partners(id, naam, email, telefoon)"
      )
      .eq("installatie_partner_id", id)
      .or("schouw_at.not.is.null,installatie_at.not.is.null")
      .order("schouw_at", { ascending: true, nullsFirst: false });

    if (error) {
      return NextResponse.json(
        { error: "Agenda laden mislukt", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      partner,
      orders: orders || [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

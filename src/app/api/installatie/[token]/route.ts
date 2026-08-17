import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

async function resolvePartner(token: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("installatie_partners")
    .select("id, naam, email, telefoon, actief, portal_token")
    .eq("portal_token", token)
    .single();
  if (error || !data || !data.actief) return null;
  return data;
}

/** GET /api/installatie/[token] — partner + orderslijst */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await resolvePartner(token);
    if (!partner) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data: orders, error } = await sb
      .from("projecten")
      .select(
        "id, project_nummer, titel, status, schouw_at, schouw_notities, notities, monteur, startdatum, opleverdatum, created_at, leads(naam, telefoon, email, postcode, huisnummer, toevoeging, straat, plaats, lead_number)"
      )
      .eq("installatie_partner_id", partner.id)
      .order("schouw_at", { ascending: true, nullsFirst: false });

    if (error) throw error;

    return NextResponse.json({
      partner: {
        id: partner.id,
        naam: partner.naam,
        email: partner.email,
      },
      orders: orders || [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

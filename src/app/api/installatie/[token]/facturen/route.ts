import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

async function resolvePartner(token: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("installatie_partners")
    .select("id, naam, email, actief, portal_token")
    .eq("portal_token", token)
    .single();
  if (error || !data || !data.actief) return null;
  return data;
}

/**
 * GET /api/installatie/[token]/facturen
 * Creditfacturen die admin voor deze partner heeft aangemaakt.
 */
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
    const { data: facturen, error } = await sb
      .from("partner_creditfacturen")
      .select(
        "id, factuur_nummer, status, week_jaar, week_nummer, periode_van, periode_tot, omschrijving, offerte_nummer, project_nummer, bedrag_ex_btw, btw_bedrag, bedrag_inc_btw, factuurdatum, betaald_op, verzonden_op, goedgekeurd_op, created_at"
      )
      .eq("partner_id", partner.id)
      .in("status", ["verzonden", "goedgekeurd", "betaald"])
      .order("factuurdatum", { ascending: false });

    if (error) {
      if (
        error.code === "42703" ||
        error.message?.includes("partner_creditfacturen")
      ) {
        return NextResponse.json({
          partner: { id: partner.id, naam: partner.naam },
          facturen: [],
          migration_needed: true,
        });
      }
      throw error;
    }

    return NextResponse.json({
      partner: { id: partner.id, naam: partner.naam },
      facturen: facturen || [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

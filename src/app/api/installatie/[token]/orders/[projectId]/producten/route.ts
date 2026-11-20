import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { assertPortalOrderAccess } from "@/lib/installatie-portal";
import { installatieProductRegelsVoorMonteur } from "@/lib/offerte-regels";

export const runtime = "nodejs";

/**
 * GET — productregels van de offerte die relevant zijn voor de installatie
 * (batterij, omvormer, meterkast, noodstroom, …).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; projectId: string }> }
) {
  const { token, projectId } = await ctx.params;
  try {
    const access = await assertPortalOrderAccess(
      token,
      projectId,
      "id, offerte_id",
      req
    );
    if (!access) {
      return NextResponse.json(
        { error: "Order niet gevonden" },
        { status: 404 }
      );
    }
    const offerteId = (access.order.offerte_id as string | null) || null;
    if (!offerteId) {
      return NextResponse.json({ producten: [] });
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("offerte_regels")
      .select("omschrijving, aantal, prijs_ex_btw, sort_order")
      .eq("offerte_id", offerteId)
      .order("sort_order", { ascending: true });
    if (error) throw error;

    return NextResponse.json({
      producten: installatieProductRegelsVoorMonteur(data || []),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Producten laden mislukt") },
      { status: 500 }
    );
  }
}

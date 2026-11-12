import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { buildOffertePdfForId } from "@/lib/offerte-pdf-build";
import {
  isWarmtefondsPortalProject,
  resolveWarmtefondsOperator,
} from "@/lib/warmtefonds-portal";

export const runtime = "nodejs";

/**
 * GET /api/warmtefonds/[token]/orders/[projectId]/offerte
 * Offerte-PDF (concept of ondertekend) voor de operator via portaal-token.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; projectId: string }> }
) {
  const { token, projectId } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const { data: order, error: oErr } = await sb
      .from("projecten")
      .select("id, offerte_id, betaalwijze, financiering_status, status")
      .eq("id", projectId)
      .maybeSingle();
    if (oErr || !order || !isWarmtefondsPortalProject(order)) {
      return NextResponse.json(
        { error: "Aanvraag niet gevonden" },
        { status: 404 }
      );
    }
    if (!order.offerte_id) {
      return NextResponse.json(
        { error: "Geen offerte gekoppeld aan deze aanvraag" },
        { status: 404 }
      );
    }

    const { data: offerte, error: offErr } = await sb
      .from("offertes")
      .select(
        "id, status, offerte_nummer, ondertekend_naam, ondertekend_op, ondertekend_handtekening"
      )
      .eq("id", order.offerte_id)
      .single();
    if (offErr || !offerte) {
      return NextResponse.json(
        { error: "Offerte niet gevonden" },
        { status: 404 }
      );
    }

    const getekend =
      offerte.status === "ondertekend" ||
      Boolean(offerte.ondertekend_op && offerte.ondertekend_handtekening);

    const sign =
      getekend &&
      offerte.ondertekend_naam &&
      offerte.ondertekend_op &&
      offerte.ondertekend_handtekening
        ? {
            naam: offerte.ondertekend_naam as string,
            handtekeningDataUrl: offerte.ondertekend_handtekening as string,
            ondertekendOp: new Date(offerte.ondertekend_op as string),
          }
        : undefined;

    const built = await buildOffertePdfForId(sb, offerte.id, sign);
    const bytes = Buffer.from(await built.blob.arrayBuffer());

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${built.filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "PDF mislukt") },
      { status: 500 }
    );
  }
}

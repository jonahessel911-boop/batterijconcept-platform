import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { buildOffertePdfForId } from "@/lib/offerte-pdf-build";

export const runtime = "nodejs";

/**
 * GET /api/offertes/[id]/pdf
 * Genereert altijd de actuele offerte-PDF (zelfde layout als ondertekenpagina).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: offerte, error } = await sb
      .from("offertes")
      .select(
        "status, ondertekend_naam, ondertekend_op, ondertekend_handtekening, offerte_nummer"
      )
      .eq("id", id)
      .single();

    if (error || !offerte) {
      return NextResponse.json({ error: "Offerte niet gevonden" }, { status: 404 });
    }

    const sign =
      offerte.ondertekend_naam &&
      offerte.ondertekend_op &&
      offerte.ondertekend_handtekening
        ? {
            naam: offerte.ondertekend_naam as string,
            handtekeningDataUrl: offerte.ondertekend_handtekening as string,
            ondertekendOp: new Date(offerte.ondertekend_op as string),
          }
        : undefined;

    const built = await buildOffertePdfForId(sb, id, sign);
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

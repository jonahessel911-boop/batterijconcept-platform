import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildSignedOffertePdf } from "@/lib/pdf-offerte";
import { adresRegel } from "@/lib/format";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * GET /api/offertes/[id]/pdf
 * Download de ondertekende offerte-PDF.
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
        `*, leads(naam, email, lead_number, postcode, huisnummer, toevoeging, straat, plaats), offerte_regels(*)`
      )
      .eq("id", id)
      .single();

    if (error || !offerte) {
      return NextResponse.json({ error: "Offerte niet gevonden" }, { status: 404 });
    }

    if (offerte.status !== "ondertekend") {
      return NextResponse.json(
        { error: "Alleen ondertekende offertes zijn als PDF te downloaden" },
        { status: 409 }
      );
    }

    const filename = `${offerte.offerte_nummer}-ondertekend.pdf`;

    const regels = (offerte.offerte_regels || []).sort(
      (a: { sort_order: number }, b: { sort_order: number }) =>
        a.sort_order - b.sort_order
    );

    const sign =
      offerte.ondertekend_naam &&
      offerte.ondertekend_op &&
      offerte.ondertekend_handtekening
        ? {
            naam: offerte.ondertekend_naam,
            handtekeningDataUrl: offerte.ondertekend_handtekening,
            ondertekendOp: new Date(offerte.ondertekend_op),
          }
        : undefined;

    if (sign) {
      const blob = await buildSignedOffertePdf({
        offerte,
        regels,
        sign,
        adres: offerte.leads ? adresRegel(offerte.leads) : undefined,
      });
      const bytes = Buffer.from(await blob.arrayBuffer());
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    if (offerte.signed_pdf_path) {
      const { data: file, error: dlErr } = await sb.storage
        .from("offertes-signed")
        .download(offerte.signed_pdf_path);
      if (!dlErr && file) {
        const bytes = Buffer.from(await file.arrayBuffer());
        return new NextResponse(bytes, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`,
          },
        });
      }
    }

    const blob = await buildSignedOffertePdf({
      offerte,
      regels,
      adres: offerte.leads ? adresRegel(offerte.leads) : undefined,
    });
    const bytes = Buffer.from(await blob.arrayBuffer());

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "PDF mislukt") },
      { status: 500 }
    );
  }
}

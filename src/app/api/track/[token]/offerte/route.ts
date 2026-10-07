import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * GET /api/track/[token]/offerte — getekende offerte PDF
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: offerte, error } = await sb
      .from("offertes")
      .select("id, offerte_nummer, status, signed_pdf_path, track_token")
      .eq("track_token", token)
      .maybeSingle();

    if (error || !offerte || offerte.status !== "ondertekend") {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }

    if (!offerte.signed_pdf_path) {
      return NextResponse.json(
        { error: "Getekende offerte nog niet beschikbaar" },
        { status: 404 }
      );
    }

    const { data: file, error: dlErr } = await sb.storage
      .from("offertes-signed")
      .download(offerte.signed_pdf_path);

    if (dlErr || !file) {
      return NextResponse.json(
        { error: "PDF download mislukt" },
        { status: 500 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const filename = `${offerte.offerte_nummer}-ondertekend.pdf`;

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

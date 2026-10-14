import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { adresRegel } from "@/lib/format";
import { buildSignedOffertePdf } from "@/lib/pdf-offerte";
import type { Offerte, OfferteRegel } from "@/types/database";

export const runtime = "nodejs";

/**
 * GET /api/track/[token]/offerte — getekende offerte PDF
 * Altijd beschikbaar voor ondertekende offertes (storage of on-the-fly regeneratie).
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
      .select(
        "*, leads(naam, email, telefoon, postcode, huisnummer, toevoeging, straat, plaats), offerte_regels(*)"
      )
      .eq("track_token", token)
      .maybeSingle();

    if (error || !offerte || offerte.status !== "ondertekend") {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }

    const filename = `${offerte.offerte_nummer}-ondertekend.pdf`;

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
            "Content-Disposition": `inline; filename="${filename}"`,
            "Cache-Control": "private, max-age=300",
          },
        });
      }
    }

    // Fallback: regenereren uit opgeslagen handtekening
    const handtekening = offerte.ondertekend_handtekening as string | null;
    const naam = (offerte.ondertekend_naam as string | null) || "klant";
    const ondertekendOp = offerte.ondertekend_op
      ? new Date(offerte.ondertekend_op as string)
      : new Date();

    if (!handtekening) {
      return NextResponse.json(
        { error: "Getekende offerte nog niet beschikbaar" },
        { status: 404 }
      );
    }

    const leadRaw = offerte.leads as
      | {
          naam?: string | null;
          postcode?: string | null;
          huisnummer?: string | null;
          toevoeging?: string | null;
          straat?: string | null;
          plaats?: string | null;
        }
      | {
          naam?: string | null;
          postcode?: string | null;
          huisnummer?: string | null;
          toevoeging?: string | null;
          straat?: string | null;
          plaats?: string | null;
        }[]
      | null;
    const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
    const regelsRaw = (offerte.offerte_regels || []) as OfferteRegel[];
    const regels = [...regelsRaw].sort(
      (a, b) => (a.sort_order || 0) - (b.sort_order || 0)
    );

    const pdfBlob = await buildSignedOffertePdf({
      offerte: offerte as unknown as Offerte,
      regels,
      sign: {
        naam,
        handtekeningDataUrl: handtekening,
        ondertekendOp,
      },
      adres: lead ? adresRegel(lead) : undefined,
    });
    const bytes = Buffer.from(await pdfBlob.arrayBuffer());

    // Best-effort opnieuw opslaan zodat volgende download uit storage komt
    const path =
      (offerte.signed_pdf_path as string | null) ||
      `${offerte.lead_id}/${filename}`;
    void sb.storage
      .from("offertes-signed")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true })
      .then(({ error: upErr }) => {
        if (upErr) {
          console.error("track offerte re-upload:", upErr);
          return;
        }
        if (!offerte.signed_pdf_path) {
          void sb
            .from("offertes")
            .update({ signed_pdf_path: path })
            .eq("id", offerte.id);
        }
      });

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

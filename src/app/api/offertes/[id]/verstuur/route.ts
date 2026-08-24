import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { buildOffertePdfForId } from "@/lib/offerte-pdf-build";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { offerteVerstuurdEmail } from "@/lib/email/templates";

export const runtime = "nodejs";

/**
 * POST /api/offertes/[id]/verstuur
 * Mailt de offerte-PDF + ondertekenlink naar de klant en zet status op verzonden.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  try {
    const sb = getSupabaseAdmin();

    const { data: row, error } = await sb
      .from("offertes")
      .select("id, status, offerte_nummer, sign_token")
      .eq("id", id)
      .single();

    if (error || !row) {
      return NextResponse.json({ error: "Offerte niet gevonden" }, { status: 404 });
    }

    if (row.status === "ondertekend") {
      return NextResponse.json(
        { error: "Deze offerte is al ondertekend" },
        { status: 409 }
      );
    }

    const built = await buildOffertePdfForId(sb, id);
    const email = built.leadEmail;
    if (!email) {
      return NextResponse.json(
        { error: "Lead heeft geen e-mailadres" },
        { status: 400 }
      );
    }

    const signUrl = `${appBaseUrl()}/offerte/${row.sign_token}`;
    const pdfBytes = Buffer.from(await built.blob.arrayBuffer());

    const sent = await sendEmail({
      to: email,
      subject: `Offerte ${row.offerte_nummer} voor ${built.leadNaam}`,
      html: offerteVerstuurdEmail({
        naam: built.leadNaam,
        offerteNummer: row.offerte_nummer,
        signUrl,
      }),
      tag: "offerte-verstuurd",
      attachments: [
        {
          name: built.filename,
          contentType: "application/pdf",
          content: pdfBytes,
        },
      ],
    });

    if (!sent.ok) {
      return NextResponse.json(
        { error: sent.error || "Mail versturen mislukt" },
        { status: 500 }
      );
    }

    const { data: updated, error: upErr } = await sb
      .from("offertes")
      .update({ status: "verzonden" })
      .eq("id", id)
      .select(
        "id, status, offerte_nummer, sign_token, leads(naam, email)"
      )
      .single();

    if (upErr) {
      return NextResponse.json(
        {
          error:
            "Mail is verstuurd, maar status bijwerken mislukt: " + upErr.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      offerte: updated,
      sign_url: signUrl,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Versturen mislukt") },
      { status: 500 }
    );
  }
}

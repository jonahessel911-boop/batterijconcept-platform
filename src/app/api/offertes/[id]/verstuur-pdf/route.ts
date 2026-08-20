import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { buildOffertePdfForId } from "@/lib/offerte-pdf-build";
import { sendEmail, appBaseUrl } from "@/lib/email/postmark";
import { offerteVerstuurdEmail } from "@/lib/email/templates";

export const runtime = "nodejs";

/**
 * POST /api/offertes/[id]/verstuur-pdf
 * Mailt de offerte opnieuw met de actuele PDF-layout + ondertekenlink.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const built = await buildOffertePdfForId(sb, id);

    if (!built.leadEmail) {
      return NextResponse.json(
        { error: "Lead heeft geen e-mailadres" },
        { status: 400 }
      );
    }

    const signToken = built.offerte.sign_token;
    if (!signToken) {
      return NextResponse.json(
        { error: "Geen ondertekenlink beschikbaar" },
        { status: 400 }
      );
    }

    const signUrl = `${appBaseUrl()}/offerte/${signToken}`;
    const pdfBytes = Buffer.from(await built.blob.arrayBuffer());

    await sendEmail({
      to: built.leadEmail,
      subject: `Offerte ${built.offerte.offerte_nummer} voor ${built.leadNaam}`,
      html: offerteVerstuurdEmail({
        naam: built.leadNaam,
        offerteNummer: built.offerte.offerte_nummer,
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

    return NextResponse.json({
      ok: true,
      emailed_to: built.leadEmail,
      filename: built.filename,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Mailen mislukt") },
      { status: 500 }
    );
  }
}

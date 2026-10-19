import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { buildOffertePdfForId } from "@/lib/offerte-pdf-build";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { replyToForLeadAdviseur } from "@/lib/email/adviseur-reply-to";
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
      .select("id, status, offerte_nummer, sign_token, verzonden_op")
      .eq("id", id)
      .single();

    type OfferteRow = {
      id: string;
      status: string;
      offerte_nummer: string;
      sign_token: string;
      verzonden_op?: string | null;
    };
    let offerte: OfferteRow | null = (row as OfferteRow | null) ?? null;
    if (error || !offerte) {
      if (error?.message?.includes("verzonden_op")) {
        const retry = await sb
          .from("offertes")
          .select("id, status, offerte_nummer, sign_token")
          .eq("id", id)
          .single();
        if (retry.error || !retry.data) {
          return NextResponse.json(
            { error: "Offerte niet gevonden" },
            { status: 404 }
          );
        }
        offerte = retry.data as OfferteRow;
      } else {
        return NextResponse.json(
          { error: "Offerte niet gevonden" },
          { status: 404 }
        );
      }
    }
    if (!offerte) {
      return NextResponse.json({ error: "Offerte niet gevonden" }, { status: 404 });
    }

    if (offerte.status === "ondertekend") {
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

    const signUrl = `${appBaseUrl()}/offerte/${offerte.sign_token}`;
    const pdfBytes = Buffer.from(await built.blob.arrayBuffer());
    const replyTo = await replyToForLeadAdviseur(
      sb,
      built.offerte.lead_id
    );

    const sent = await sendEmail({
      to: email,
      subject: `Offerte ${offerte.offerte_nummer} voor ${built.leadNaam}`,
      html: offerteVerstuurdEmail({
        naam: built.leadNaam,
        offerteNummer: offerte.offerte_nummer,
        signUrl,
      }),
      tag: "offerte-verstuurd",
      replyTo,
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

    const patch: { status: string; verzonden_op?: string } = {
      status: "verzonden",
    };
    // Alleen eerste verzending vastleggen
    if (!offerte.verzonden_op) {
      patch.verzonden_op = new Date().toISOString();
    }

    let updated: Record<string, unknown> | null = null;
    let upErr: { message?: string } | null = null;
    {
      const res = await sb
        .from("offertes")
        .update(patch)
        .eq("id", id)
        .select(
          "id, status, offerte_nummer, sign_token, verzonden_op, leads(naam, email)"
        )
        .single();
      updated = res.data as Record<string, unknown> | null;
      upErr = res.error;
      // Graceful als migratie nog niet gedraaid is
      if (
        upErr &&
        (upErr.message?.includes("verzonden_op") ||
          upErr.message?.includes("schema cache"))
      ) {
        const retry = await sb
          .from("offertes")
          .update({ status: "verzonden" })
          .eq("id", id)
          .select(
            "id, status, offerte_nummer, sign_token, leads(naam, email)"
          )
          .single();
        updated = retry.data as Record<string, unknown> | null;
        upErr = retry.error;
      }
    }

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

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { sendEmail } from "@/lib/email/postmark";
import { INFO_REPLY_TO } from "@/lib/email/adviseur-reply-to";
import {
  sollicitatieGeenContactPoging1Email,
  sollicitatieGeenContactPoging3Email,
} from "@/lib/email/templates";
import { appendStampedNotitie } from "@/lib/lead-notitie";
import { SOLLICITATIE_MAX_BELPOGINGEN } from "@/lib/sollicitatie-bel";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";

export const runtime = "nodejs";

/**
 * POST /api/instroom/[id]/geen-contact-mail
 * Body: { poging: 1 | 3 }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await ctx.params;
  let body: { poging?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const poging = Number(body.poging);
  if (poging !== 1 && poging !== 3) {
    return NextResponse.json(
      { error: "poging moet 1 of 3 zijn" },
      { status: 400 }
    );
  }
  if (poging > SOLLICITATIE_MAX_BELPOGINGEN) {
    return NextResponse.json({ error: "Ongeldige poging" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: row, error } = await sb
      .from("sollicitaties")
      .select("id, naam, email, functie, notitie")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!row) {
      return NextResponse.json(
        { error: "Sollicitatie niet gevonden" },
        { status: 404 }
      );
    }

    const email = (row.email || "").trim();
    if (!email) {
      return NextResponse.json(
        { ok: false, skipped: true, reason: "geen_email" },
        { status: 200 }
      );
    }

    const naam = row.naam || "kandidaat";
    const functie = (row.functie as string | null) || null;
    const isFirst = poging === 1;
    const subject = isFirst
      ? `We hebben je geprobeerd te bellen voor ${functie || "de functie"} — BatterijConcept`
      : `Nog interesse in ${functie || "de functie"}? — BatterijConcept`;
    const html = isFirst
      ? sollicitatieGeenContactPoging1Email({ naam, functie })
      : sollicitatieGeenContactPoging3Email({ naam, functie });
    const tag = isFirst
      ? "sollicitatie-geen-contact-1"
      : "sollicitatie-geen-contact-3";

    const result = await sendEmail({
      to: email,
      subject,
      html,
      tag,
      replyTo: INFO_REPLY_TO,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Mail versturen mislukt" },
        { status: 502 }
      );
    }

    // Bewaar in inbox_mails zodat replies in de recruitment-thread landen.
    const fromEmail =
      process.env.POSTMARK_FROM_EMAIL || "info@batterijconcept.nl";
    try {
      await sb.from("inbox_mails").insert({
        folder: "verzonden",
        status: "afgehandeld",
        direction: "outbound",
        message_id: result.messageId || null,
        thread_id: result.messageId || `sol-gc-${id}-${poging}`,
        from_name: "BatterijConcept Recruitment",
        from_email: fromEmail,
        to_email: email,
        subject,
        body_text: `Geen-contact mail #${poging} (${functie || "functie"})`,
        body_html: html,
        received_at: new Date().toISOString(),
        suggested_actions: [],
        raw_headers: { postmark_tag: tag },
      });
    } catch (err) {
      console.error("geen-contact inbox_mails insert:", err);
    }

    const note = appendStampedNotitie(
      row.notitie as string | null,
      `Geen-contact mail #${poging} verstuurd (${functie || "functie"}) → ${email}`
    );
    await sb.from("sollicitaties").update({ notitie: note }).eq("id", id);

    return NextResponse.json({
      ok: true,
      messageId: result.messageId || null,
      tag,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Mail versturen mislukt") },
      { status: 500 }
    );
  }
}

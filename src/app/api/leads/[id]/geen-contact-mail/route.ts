import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { sendEmail } from "@/lib/email/postmark";
import {
  geenContactPoging1Email,
  geenContactPoging3Email,
} from "@/lib/email/templates";
import { logLeadEvent } from "@/lib/lead-events";

export const runtime = "nodejs";

/**
 * POST /api/leads/[id]/geen-contact-mail
 * Body: { poging: 1 | 3 }
 * Verstuurt de juiste “geen contact”-mail na belpoging 1 of 3.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: { poging?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const poging = body.poging;
  if (poging !== 1 && poging !== 3) {
    return NextResponse.json(
      { error: "poging moet 1 of 3 zijn" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: lead, error } = await sb
      .from("leads")
      .select("id, naam, email")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!lead) {
      return NextResponse.json({ error: "Lead niet gevonden" }, { status: 404 });
    }

    const email = (lead.email || "").trim();
    if (!email) {
      return NextResponse.json(
        { ok: false, skipped: true, reason: "geen_email" },
        { status: 200 }
      );
    }

    const naam = lead.naam || "klant";
    const isFirst = poging === 1;
    const subject = isFirst
      ? "We hebben je geprobeerd te bereiken — Batterijconcept"
      : "Heeft u nog interesse in een batterij zonder eigen investering? — Batterijconcept";
    const html = isFirst
      ? geenContactPoging1Email({ naam })
      : geenContactPoging3Email({ naam });
    const tag = isFirst ? "lead-geen-contact-1" : "lead-geen-contact-3";

    const result = await sendEmail({
      to: email,
      subject,
      html,
      tag,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Mail versturen mislukt" },
        { status: 502 }
      );
    }

    await logLeadEvent({
      leadId: id,
      soort: "contact",
      titel: isFirst
        ? "Geen-contact mail #1 verstuurd"
        : "Geen-contact mail #3 verstuurd",
      detail: subject,
      meta: { poging, tag, messageId: result.messageId || null },
    });

    return NextResponse.json({ ok: true, poging, messageId: result.messageId });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Geen-contact mail mislukt") },
      { status: 500 }
    );
  }
}

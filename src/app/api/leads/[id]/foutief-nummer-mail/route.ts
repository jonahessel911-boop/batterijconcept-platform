import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { sendEmail } from "@/lib/email/postmark";
import { foutiefNummerEmail } from "@/lib/email/templates";
import { logLeadEvent } from "@/lib/lead-events";

export const runtime = "nodejs";

/**
 * POST /api/leads/[id]/foutief-nummer-mail
 * Verstuurt mail: telefoonnummer onjuist — reageren voor afspraak.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  try {
    const sb = getSupabaseAdmin();
    const { data: lead, error } = await sb
      .from("leads")
      .select("id, naam, email, telefoon")
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
    const subject =
      "Het ingevulde telefoonnummer is onjuist — Batterijconcept";
    const html = foutiefNummerEmail({
      naam,
      telefoon: lead.telefoon,
    });

    const result = await sendEmail({
      to: email,
      subject,
      html,
      tag: "lead-foutief-nummer",
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
      titel: "Foutief-nummer mail verstuurd",
      detail: subject,
      meta: {
        tag: "lead-foutief-nummer",
        telefoon: lead.telefoon || null,
        messageId: result.messageId || null,
      },
    });

    return NextResponse.json({ ok: true, messageId: result.messageId });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Foutief-nummer mail mislukt") },
      { status: 500 }
    );
  }
}

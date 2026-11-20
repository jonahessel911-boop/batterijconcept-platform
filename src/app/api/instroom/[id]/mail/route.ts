import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { sendEmail } from "@/lib/email/postmark";
import { inboxReplyHtml } from "@/lib/email/reply-html";
import { appendStampedNotitie } from "@/lib/lead-notitie";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";
import { storePostmarkMessageId } from "@/lib/inbox-message-id";

export const runtime = "nodejs";
export const maxDuration = 60;

const FROM = process.env.POSTMARK_FROM_EMAIL || "info@batterijconcept.nl";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/instroom/[id]/mail
 * Vrije mail naar een kandidaat vanaf info@, landt in de recruitment-inbox.
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
  let body: { subject?: string; bodyText?: string; to?: string; templateId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const subject = (body.subject || "").trim();
  const bodyText = (body.bodyText || "").trim();
  if (!subject || !bodyText) {
    return NextResponse.json(
      { error: "Onderwerp en bericht zijn verplicht" },
      { status: 400 }
    );
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

    const requestedTo = (body.to || "").trim();
    const to =
      requestedTo && EMAIL_RE.test(requestedTo)
        ? requestedTo
        : (row.email || "").trim();
    if (!to || !EMAIL_RE.test(to)) {
      return NextResponse.json(
        { error: "Deze kandidaat heeft geen geldig e-mailadres" },
        { status: 400 }
      );
    }

    const templateId = (body.templateId || "").trim();
    const html = inboxReplyHtml({ subject, bodyText });
    const result = await sendEmail({
      to,
      subject,
      html,
      text: bodyText,
      tag:
        templateId === "info_toegestuurd"
          ? "recruitment-info-toegestuurd"
          : "recruitment-kandidaat-mail",
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Mail versturen mislukt" },
        { status: 502 }
      );
    }

    try {
      const storedId = storePostmarkMessageId(result.messageId);
      await sb.from("inbox_mails").insert({
        folder: "verzonden",
        status: "afgehandeld",
        direction: "outbound",
        message_id: storedId,
        thread_id: storedId || `sol-mail-${id}`,
        from_name: "BatterijConcept Recruitment",
        from_email: FROM,
        to_email: to,
        subject,
        body_text: bodyText,
        body_html: html,
        received_at: new Date().toISOString(),
        suggested_actions: [],
        raw_headers: {
          postmark_tag:
            templateId === "info_toegestuurd"
              ? "recruitment-info-toegestuurd"
              : "recruitment-kandidaat-mail",
        },
      });
    } catch (err) {
      console.error("kandidaat-mail inbox_mails insert:", err);
    }

    const noteLine =
      templateId === "info_toegestuurd"
        ? `Info toegestuurd → ${to}`
        : `Mail verstuurd → ${to}: ${bodyText.slice(0, 280)}${bodyText.length > 280 ? "…" : ""}`;
    const note = appendStampedNotitie(row.notitie as string | null, noteLine);
    await sb
      .from("sollicitaties")
      .update({ notitie: note, updated_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({
      ok: true,
      messageId: result.messageId || null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Mail versturen mislukt") },
      { status: 500 }
    );
  }
}

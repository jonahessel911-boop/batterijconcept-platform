import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/postmark";
import { inboxReplyHtml } from "@/lib/email/reply-html";
import { errMessage } from "@/lib/errors";
import { getInboxMail, rowToInboxMail } from "@/lib/inbox-persist";
import { appendStampedNotitie } from "@/lib/lead-notitie";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const FROM = process.env.POSTMARK_FROM_EMAIL || "info@batterijconcept.nl";

function angleId(raw: string | null | undefined): string | null {
  const s = (raw || "").trim().replace(/^<|>$/g, "");
  if (!s) return null;
  return `<${s}>`;
}

/**
 * POST /api/instroom/inbox/[id]/reply
 * Reply vanaf info@ (recruitment), met In-Reply-To.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      subject?: string;
      bodyText?: string;
      to?: string;
      sollicitatie_id?: string | null;
    };
    const subject = (body.subject || "").trim();
    const bodyText = (body.bodyText || "").trim();
    if (!subject || !bodyText) {
      return NextResponse.json(
        { error: "Onderwerp en bericht zijn verplicht" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const original = await getInboxMail(sb, id);
    if (!original) {
      return NextResponse.json({ error: "Mail niet gevonden" }, { status: 404 });
    }

    const requestedTo = (body.to || "").trim();
    const to =
      requestedTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedTo)
        ? requestedTo
        : original.from_email.trim();
    const parentId = angleId(original.message_id);
    const when = new Date(original.received_at);
    const whenLabel = Number.isNaN(when.getTime())
      ? ""
      : when.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" });
    const fromAddr = original.from_email.trim();
    const quoteHead = `Op ${whenLabel} schreef ${original.from_name || fromAddr} <${fromAddr}>:`;
    const quoted = (original.body_text || "")
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const fullText = `${bodyText}\n\n${quoteHead}\n${quoted}`;
    const html = inboxReplyHtml({ subject, bodyText });

    const sent = await sendEmail({
      to,
      subject,
      html,
      text: fullText,
      replyTo: FROM,
      tag: "recruitment-inbox-reply",
      headers: parentId
        ? [
            { name: "In-Reply-To", value: parentId },
            { name: "References", value: parentId },
          ]
        : undefined,
    });
    if (!sent.ok) {
      return NextResponse.json(
        { error: sent.error || "Versturen mislukt" },
        { status: 502 }
      );
    }

    const solId = (body.sollicitatie_id || "").trim() || null;
    if (solId) {
      try {
        const { data: sol } = await sb
          .from("sollicitaties")
          .select("id, notitie")
          .eq("id", solId)
          .maybeSingle();
        if (sol) {
          const note = appendStampedNotitie(
            sol.notitie as string | null,
            `Inbox-antwoord → ${to}: ${bodyText.slice(0, 280)}${bodyText.length > 280 ? "…" : ""}`
          );
          await sb
            .from("sollicitaties")
            .update({ notitie: note, updated_at: new Date().toISOString() })
            .eq("id", solId);
        }
      } catch (err) {
        console.error("recruitment inbox reply notitie:", err);
      }
    }

    const threadId = original.thread_id || original.message_id || original.id;
    const { data: saved, error: saveError } = await sb
      .from("inbox_mails")
      .insert({
        folder: "verzonden",
        status: "afgehandeld",
        direction: "outbound",
        message_id: sent.messageId || null,
        in_reply_to: parentId,
        thread_id: threadId,
        from_name: "BatterijConcept Recruitment",
        from_email: FROM,
        to_email: to,
        subject,
        body_text: bodyText,
        body_html: html,
        received_at: new Date().toISOString(),
        suggested_actions: [],
        raw_headers: { postmark_tag: "recruitment-inbox-reply" },
      })
      .select(
        "id, folder, status, from_name, from_email, to_email, subject, body_text, body_html, received_at, lead_id, project_id, afspraak_id, suggested_actions, thread_id, message_id, in_reply_to, raw_headers"
      )
      .maybeSingle();

    // Origineel archiveren én thread_id vastzetten zodat conversatie blijft matchen.
    await sb
      .from("inbox_mails")
      .update({
        status: "gearchiveerd",
        folder: "archief",
        thread_id: original.thread_id || threadId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", original.id);

    return NextResponse.json({
      ok: true,
      messageId: sent.messageId,
      saved: !saveError,
      saveError: saveError?.message || null,
      archived: true,
      mail: saved ? rowToInboxMail(saved as never) : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Antwoord versturen mislukt") },
      { status: 500 }
    );
  }
}

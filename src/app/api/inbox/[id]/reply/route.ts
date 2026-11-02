import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { sendEmail } from "@/lib/email/postmark";
import { inboxReplyHtml } from "@/lib/email/reply-html";
import { errMessage } from "@/lib/errors";
import { logInboxMailNotitie } from "@/lib/inbox-notitie";
import { getInboxMail, rowToInboxMail } from "@/lib/inbox-persist";
import { normalizeRol } from "@/lib/rollen";
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
 * POST /api/inbox/[id]/reply
 * Verstuurt een echte reply (In-Reply-To + References) vanaf info@.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const rol = normalizeRol(session.rol);
    if (rol !== "admin" && rol !== "backoffice") {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      subject?: string;
      bodyText?: string;
      to?: string;
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
      tag: "inbox-reply",
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

    let leadId = original.lead_id;
    let projectId = original.project_id;
    try {
      const linked = await logInboxMailNotitie(sb, {
        leadId,
        projectId,
        direction: "outbound",
        fromName: "BatterijConcept",
        fromEmail: FROM,
        toEmail: to,
        subject,
        bodyText,
        at: new Date(),
        author: session.naam,
        messageId: sent.messageId || null,
        matchEmail: to,
      });
      leadId = linked.leadId || leadId;
      projectId = linked.projectId || projectId;
      if (linked.leadId && !original.lead_id) {
        await sb
          .from("inbox_mails")
          .update({
            lead_id: linked.leadId,
            ...(linked.projectId ? { project_id: linked.projectId } : {}),
          })
          .eq("id", original.id);
      }
    } catch (err) {
      console.error("inbox reply notitie:", err);
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
        from_name: "BatterijConcept",
        from_email: FROM,
        to_email: to,
        subject,
        body_text: bodyText,
        body_html: html,
        received_at: new Date().toISOString(),
        lead_id: leadId,
        project_id: projectId,
        afspraak_id: original.afspraak_id,
        suggested_actions: [],
      })
      .select(
        "id, folder, status, from_name, from_email, to_email, subject, body_text, body_html, received_at, lead_id, project_id, afspraak_id, suggested_actions, thread_id, message_id, in_reply_to, raw_headers"
      )
      .maybeSingle();

    // Weg uit open inbox: beantwoord → archief
    const { error: archiveError } = await sb
      .from("inbox_mails")
      .update({
        status: "gearchiveerd",
        folder: "archief",
        updated_at: new Date().toISOString(),
      })
      .eq("id", original.id);

    if (archiveError) {
      console.error("inbox archive after reply:", archiveError);
      return NextResponse.json(
        {
          error: `Verstuurd, maar archiveren mislukt: ${archiveError.message}`,
          messageId: sent.messageId,
          mail: saved ? rowToInboxMail(saved as never) : null,
          archived: false,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      messageId: sent.messageId,
      saved: !saveError,
      saveError: saveError?.message || null,
      archived: true,
      archivedId: original.id,
      mail: saved ? rowToInboxMail(saved as never) : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Antwoord versturen mislukt") },
      { status: 500 }
    );
  }
}

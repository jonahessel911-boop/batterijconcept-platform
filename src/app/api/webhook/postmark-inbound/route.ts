import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  parsePostmarkFrom,
  parseReceivedAt,
  sanitizePostmarkPayloadForStorage,
  uploadInkomendeFactuurBytes,
  type PostmarkInboundAttachment,
  type PostmarkInboundPayload,
} from "@/lib/inkomende-facturen";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Postmark inbound webhook auth.
 * Ondersteunt:
 * - Basic Auth (user/pass in webhook-URL of headers) via
 *   POSTMARK_INBOUND_BASIC_USER + POSTMARK_INBOUND_BASIC_PASS
 * - Of shared secret via header x-webhook-secret /
 *   Authorization: Bearer … / ?secret=…
 *   env: POSTMARK_INBOUND_WEBHOOK_SECRET
 *
 * Zonder secrets gezet: open in development, geweigerd in production.
 */
function authorizeInbound(req: NextRequest): boolean {
  const basicUser = process.env.POSTMARK_INBOUND_BASIC_USER?.trim();
  const basicPass = process.env.POSTMARK_INBOUND_BASIC_PASS?.trim();
  const shared = process.env.POSTMARK_INBOUND_WEBHOOK_SECRET?.trim();
  const isProd = process.env.NODE_ENV === "production";

  if (!basicUser && !basicPass && !shared) {
    return !isProd;
  }

  if (basicUser && basicPass) {
    const header = req.headers.get("authorization") || "";
    const match = /^Basic\s+(.+)$/i.exec(header);
    if (match) {
      try {
        const decoded = Buffer.from(match[1], "base64").toString("utf8");
        const idx = decoded.indexOf(":");
        const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
        const pass = idx >= 0 ? decoded.slice(idx + 1) : "";
        if (user === basicUser && pass === basicPass) return true;
      } catch {
        /* ignore */
      }
    }
  }

  if (shared) {
    const provided =
      req.headers.get("x-webhook-secret")?.trim() ||
      req.headers.get("x-postmark-secret")?.trim() ||
      (req.headers.get("authorization") || "")
        .replace(/^Bearer\s+/i, "")
        .trim() ||
      req.nextUrl.searchParams.get("secret")?.trim() ||
      "";
    if (provided && provided === shared) return true;
  }

  return false;
}

function attachmentBytes(
  att: PostmarkInboundAttachment
): Buffer | null {
  const raw = typeof att.Content === "string" ? att.Content.trim() : "";
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw.replace(/\s+/g, ""), "base64");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/webhook/postmark-inbound",
    method: "POST",
    description:
      "Ontvangt Postmark inbound e-mails (facturen / bonnetjes) en slaat ze op voor boekhouding.",
    auth: {
      basic:
        "POSTMARK_INBOUND_BASIC_USER + POSTMARK_INBOUND_BASIC_PASS (Authorization: Basic …)",
      secret:
        "POSTMARK_INBOUND_WEBHOOK_SECRET via x-webhook-secret, Bearer, of ?secret=",
    },
    postmark_url_example:
      "https://USER:PASS@platform.batterijconcept.nl/api/webhook/postmark-inbound",
  });
}

export async function POST(req: NextRequest) {
  if (!authorizeInbound(req)) {
    return NextResponse.json({ error: "Unauthorized webhook" }, { status: 401 });
  }

  let payload: PostmarkInboundPayload;
  try {
    payload = (await req.json()) as PostmarkInboundPayload;
  } catch {
    return NextResponse.json(
      { error: "Ongeldige JSON (verwacht Postmark inbound payload)" },
      { status: 400 }
    );
  }

  const messageId =
    typeof payload.MessageID === "string" && payload.MessageID.trim()
      ? payload.MessageID.trim()
      : null;

  if (!messageId && !payload.From && !payload.Subject) {
    return NextResponse.json(
      { error: "Geen Postmark inbound payload herkend" },
      { status: 400 }
    );
  }

  const { email: fromEmail, name: fromName } = parsePostmarkFrom(payload);
  const toEmail =
    (typeof payload.OriginalRecipient === "string" &&
      payload.OriginalRecipient.trim()) ||
    (typeof payload.To === "string" ? payload.To.trim() : null) ||
    null;
  const subject =
    typeof payload.Subject === "string" ? payload.Subject.trim() : null;
  const bodyText =
    (typeof payload.StrippedTextReply === "string" &&
      payload.StrippedTextReply.trim()) ||
    (typeof payload.TextBody === "string" ? payload.TextBody : null) ||
    null;
  const bodyHtml =
    typeof payload.HtmlBody === "string" ? payload.HtmlBody : null;
  const receivedAt = parseReceivedAt(
    typeof payload.Date === "string" ? payload.Date : null
  );

  const attachments = Array.isArray(payload.Attachments)
    ? payload.Attachments
    : [];

  try {
    const sb = getSupabaseAdmin();

    // Idempotent: zelfde MessageID → bestaande rij teruggeven
    if (messageId) {
      const { data: existing } = await sb
        .from("inkomende_facturen")
        .select("id, postmark_message_id, status, created_at")
        .eq("postmark_message_id", messageId)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({
          ok: true,
          duplicate: true,
          id: existing.id,
        });
      }
    }

    const { data: row, error: insertErr } = await sb
      .from("inkomende_facturen")
      .insert({
        postmark_message_id: messageId,
        from_email: fromEmail,
        from_name: fromName,
        to_email: toEmail,
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
        received_at: receivedAt,
        status: "nieuw",
        leverancier: fromName || fromEmail,
        raw_payload: sanitizePostmarkPayloadForStorage(payload),
      })
      .select("id, postmark_message_id, status, created_at")
      .single();

    if (insertErr || !row) {
      // Race op unique message id
      if (messageId && insertErr?.code === "23505") {
        const { data: existing } = await sb
          .from("inkomende_facturen")
          .select("id")
          .eq("postmark_message_id", messageId)
          .maybeSingle();
        if (existing) {
          return NextResponse.json({
            ok: true,
            duplicate: true,
            id: existing.id,
          });
        }
      }
      return NextResponse.json(
        {
          error: "Opslaan mislukt",
          detail: insertErr?.message || errMessage(insertErr),
        },
        { status: 500 }
      );
    }

    const uploaded: { name: string; id: string }[] = [];
    const uploadErrors: string[] = [];

    for (const att of attachments) {
      const bytes = attachmentBytes(att);
      if (!bytes) continue;
      const name =
        (typeof att.Name === "string" && att.Name.trim()) || "bijlage.bin";
      const result = await uploadInkomendeFactuurBytes(sb, row.id, {
        bytes,
        bestandsnaam: name,
        mimeType:
          typeof att.ContentType === "string" ? att.ContentType : null,
        contentId:
          typeof att.ContentID === "string" && att.ContentID.trim()
            ? att.ContentID.trim()
            : null,
      });
      if ("error" in result) {
        uploadErrors.push(`${name}: ${result.error}`);
      } else {
        uploaded.push({ name, id: result.bestand.id });
      }
    }

    // AI-scan op de achtergrond (alleen als OPENAI_API_KEY gezet is)
    let aiQueued = false;
    if (uploaded.length > 0) {
      try {
        const { openaiConfigured, scanAndPersistInkomendeFactuur } =
          await import("@/lib/inkomende-factuur-ai");
        if (openaiConfigured()) {
          aiQueued = true;
          void scanAndPersistInkomendeFactuur(sb, row.id).catch((err) => {
            console.error("[inkomend] AI-scan failed", row.id, err);
          });
        }
      } catch (err) {
        console.error("[inkomend] AI-scan import failed", err);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        id: row.id,
        attachments: uploaded.length,
        ai_queued: aiQueued,
        upload_errors: uploadErrors.length ? uploadErrors : undefined,
      },
      { status: uploadErrors.length ? 207 : 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: "Webhook mislukt", detail: errMessage(e) },
      { status: 500 }
    );
  }
}

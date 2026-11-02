import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import { applyInboxBooking, type InboxMail } from "@/lib/inbox";
import { bookInboxMail, openaiInboxConfigured } from "@/lib/inbox-ai";
import {
  insertBookedInboxMail,
  rowToInboxMail,
} from "@/lib/inbox-persist";
import { normalizeRol } from "@/lib/rollen";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/inbox/inbound
 * Handmatige / webhook inbound: AI-boek + persist.
 * Auth: CRM-sessie (admin/BO) of Bearer INBOX_INBOUND_SECRET.
 */
export async function POST(req: NextRequest) {
  try {
    const inboundSecret = process.env.INBOX_INBOUND_SECRET?.trim();
    const auth = req.headers.get("authorization") || "";
    const bearerOk =
      inboundSecret && auth === `Bearer ${inboundSecret}`;

    if (!bearerOk) {
      const jar = await cookies();
      const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
      if (!session) {
        return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
      }
      const rol = normalizeRol(session.rol);
      if (rol !== "admin" && rol !== "backoffice") {
        return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
      }
    }

    const body = (await req.json().catch(() => ({}))) as {
      fromName?: string;
      fromEmail?: string;
      toEmail?: string;
      subject?: string;
      bodyText?: string;
      bodyHtml?: string;
      messageId?: string;
      receivedAt?: string;
    };

    const fromEmail = (body.fromEmail || "").trim().toLowerCase();
    const subject = (body.subject || "").trim();
    const bodyText = (body.bodyText || "").trim();
    if (!fromEmail) {
      return NextResponse.json(
        { error: "fromEmail verplicht" },
        { status: 400 }
      );
    }
    if (!subject && !bodyText) {
      return NextResponse.json(
        { error: "subject of bodyText verplicht" },
        { status: 400 }
      );
    }

    const draft: InboxMail = {
      id: body.messageId?.trim() || `in-${Date.now()}`,
      folder: "algemeen",
      status: "nieuw",
      fromName: (body.fromName || "").trim() || fromEmail,
      fromEmail,
      toEmail: (body.toEmail || "info@batterijconcept.nl").trim(),
      subject: subject || "(geen onderwerp)",
      bodyText,
      receivedAt: body.receivedAt || new Date().toISOString(),
      suggestedActions: [],
      aiClassifiedAt: null,
      threadId: body.messageId?.trim() || undefined,
    };

    const booked = await bookInboxMail({
      subject: draft.subject,
      bodyText: draft.bodyText,
      fromName: draft.fromName,
      fromEmail: draft.fromEmail,
    });

    const mail = applyInboxBooking(draft, {
      folder: booked.folder,
      summary: booked.summary,
      confidence: booked.confidence,
      functionName: booked.functionName,
      effects: booked.effects,
    });

    const sb = getSupabaseAdmin();
    const persisted = await insertBookedInboxMail(sb, mail, {
      messageId: body.messageId?.trim() || null,
      bodyHtml: body.bodyHtml || null,
      aiFunction: booked.functionName,
    });

    return NextResponse.json({
      mail: persisted.row ? rowToInboxMail(persisted.row) : mail,
      booking: booked,
      inserted: persisted.inserted,
      skipped: Boolean(persisted.skipped),
      openai: openaiInboxConfigured(),
    });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

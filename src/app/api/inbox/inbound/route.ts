import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import { applyInboxBooking, type InboxMail } from "@/lib/inbox";
import { bookInboxMail, openaiInboxConfigured } from "@/lib/inbox-ai";
import { normalizeRol } from "@/lib/rollen";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/inbox/inbound
 *
 * Nieuwe inkomende mail (straks vanuit IMAP/webhook):
 * 1) ontvang payload
 * 2) AI function call book_to_*
 * 3) geef geboekte mail terug
 *
 * Nu: session-auth (CRM). Later: shared secret voor mail-worker.
 */
export async function POST(req: NextRequest) {
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

    const body = (await req.json().catch(() => ({}))) as {
      fromName?: string;
      fromEmail?: string;
      toEmail?: string;
      subject?: string;
      bodyText?: string;
      messageId?: string;
      receivedAt?: string;
    };

    const fromEmail = (body.fromEmail || "").trim();
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

    // TODO IMAP-persist: insert inbox_mails + run effects
    // - createServiceVerzoek → POST service-verzoeken
    // - cancelAfspraak → PATCH afspraken annuleer
    // - leadGeenContact / leadGeenInteresse → lead status

    return NextResponse.json({
      mail,
      booking: booked,
      openai: openaiInboxConfigured(),
    });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

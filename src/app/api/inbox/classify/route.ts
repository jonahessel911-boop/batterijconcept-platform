import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import { bookInboxMail, openaiInboxConfigured } from "@/lib/inbox-ai";
import { normalizeRol } from "@/lib/rollen";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/inbox/classify
 * AI kiest book_to_* function call → folder + effects.
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
      subject?: string;
      bodyText?: string;
      fromName?: string;
      fromEmail?: string;
    };
    const subject = (body.subject || "").trim();
    const bodyText = (body.bodyText || "").trim();
    if (!subject && !bodyText) {
      return NextResponse.json(
        { error: "subject of bodyText verplicht" },
        { status: 400 }
      );
    }

    const result = await bookInboxMail({
      subject,
      bodyText,
      fromName: body.fromName,
      fromEmail: body.fromEmail,
    });

    return NextResponse.json({
      folder: result.folder,
      functionName: result.functionName,
      summary: result.summary,
      confidence: result.confidence,
      effects: result.effects,
      source: result.source,
      openai: openaiInboxConfigured(),
    });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

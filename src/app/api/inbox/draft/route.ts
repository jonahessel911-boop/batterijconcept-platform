import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import { draftInboxReply } from "@/lib/inbox-ai";
import { normalizeRol } from "@/lib/rollen";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST /api/inbox/draft — AI-concept voor een antwoord. */
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
      klantEmail?: string;
      agentNaam?: string;
      thread?: {
        fromUs?: boolean;
        fromName?: string;
        at?: string;
        subject?: string;
        body?: string;
      }[];
      context?: {
        folder?: string | null;
        aiSummary?: string | null;
        cancelAfspraak?: boolean;
        leadGeenContact?: boolean;
        leadGeenInteresse?: boolean;
        createServiceVerzoek?: boolean;
        leadNaam?: string | null;
        leadStatus?: string | null;
        leadPlaats?: string | null;
        leadNumber?: string | null;
        projectNummer?: string | null;
        projectStatus?: string | null;
        afspraak?: {
          startAt?: string | null;
          status?: string | null;
          soort?: string | null;
          adviseurNaam?: string | null;
        } | null;
      };
    };
    const draft = await draftInboxReply({
      subject: body.subject || "",
      bodyText: body.bodyText || "",
      fromName: body.fromName,
      fromEmail: body.fromEmail,
      klantEmail: body.klantEmail,
      agentNaam: body.agentNaam || session.naam || undefined,
      thread: Array.isArray(body.thread)
        ? body.thread
            .filter((m) => typeof m?.body === "string")
            .slice(-12)
            .map((m) => ({
              fromUs: Boolean(m.fromUs),
              fromName: m.fromName,
              at: m.at,
              subject: m.subject,
              body: m.body || "",
            }))
        : undefined,
      context: body.context || null,
    });
    return NextResponse.json({ ok: true, ...draft });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Concept mislukt") },
      { status: 500 }
    );
  }
}

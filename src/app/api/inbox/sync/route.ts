import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import { imapConfigured, syncInboxFromImap } from "@/lib/inbox-imap";
import { rowToInboxMail } from "@/lib/inbox-persist";
import { normalizeRol } from "@/lib/rollen";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/inbox/sync
 * Haal UNSEEN mails via IMAP, AI-boek, sla op in inbox_mails.
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

    if (!imapConfigured()) {
      return NextResponse.json(
        {
          error:
            "IMAP niet geconfigureerd. Zet IMAP_HOST, IMAP_USER en IMAP_PASS in de omgeving.",
          configured: false,
        },
        { status: 503 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      max?: number;
      recent?: boolean;
    };
    const sb = getSupabaseAdmin();
    const result = await syncInboxFromImap(sb, {
      maxMessages: body.max,
      recent: Boolean(body.recent),
      ...(body.recent ? { markSeen: false } : {}),
    });

    return NextResponse.json({
      ok: result.ok,
      configured: result.configured,
      openai: result.openai,
      fetched: result.fetched,
      inserted: result.inserted,
      skipped: result.skipped,
      errors: result.errors,
      mails: result.mails.map(rowToInboxMail),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "IMAP sync mislukt") },
      { status: 500 }
    );
  }
}

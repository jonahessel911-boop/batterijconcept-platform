/**
 * GET  /api/facturen-mailbox — mails in facturen@
 * POST /api/facturen-mailbox — IMAP sync (admin)
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import {
  FACTUREN_MAILBOX_EMAIL,
  facturenImapConfigured,
} from "@/lib/facturen-mailbox";
import { syncFacturenMailboxFromImap } from "@/lib/inbox-imap";
import { listInboxMails, rowToInboxMail } from "@/lib/inbox-persist";
import { normalizeRol } from "@/lib/rollen";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

async function requireAdmin() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return { error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }) };
  }
  if (normalizeRol(session.rol) !== "admin") {
    return { error: NextResponse.json({ error: "Alleen admin" }, { status: 403 }) };
  }
  return { session };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth && auth.error) return auth.error;

    const limit = Number(req.nextUrl.searchParams.get("limit") || 150) || 150;
    const sb = getSupabaseAdmin();
    const rows = await listInboxMails(sb, {
      mailbox: "facturen",
      limit,
    });
    return NextResponse.json({
      email: FACTUREN_MAILBOX_EMAIL,
      configured: facturenImapConfigured(),
      mails: rows.map(rowToInboxMail),
      count: rows.length,
      hint: "Run supabase/migrate-inbox-mailbox.sql indien mailbox-kolom ontbreekt",
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Facturen-mailbox laden mislukt") },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth && auth.error) return auth.error;

    if (!facturenImapConfigured()) {
      return NextResponse.json(
        {
          error:
            "FACTUREN_IMAP_PASS (en IMAP_HOST) ontbreken in env",
        },
        { status: 503 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      recent?: boolean;
      max?: number;
    };
    const sb = getSupabaseAdmin();
    const result = await syncFacturenMailboxFromImap(sb, {
      maxMessages: body.max || 40,
      recent: Boolean(body.recent),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Facturen IMAP sync mislukt") },
      { status: 500 }
    );
  }
}

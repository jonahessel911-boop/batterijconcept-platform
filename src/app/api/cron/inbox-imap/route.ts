import { NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import { imapConfigured, syncInboxFromImap } from "@/lib/inbox-imap";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/cron/inbox-imap
 * Elke 5 min: UNSEEN → AI → inbox_mails.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const q = new URL(req.url).searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    if (!imapConfigured()) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "IMAP niet geconfigureerd",
      });
    }

    const sb = getSupabaseAdmin();
    const result = await syncInboxFromImap(sb, { maxMessages: 25 });
    return NextResponse.json({
      ok: result.ok,
      fetched: result.fetched,
      inserted: result.inserted,
      skipped: result.skipped,
      errors: result.errors,
      openai: result.openai,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "IMAP cron mislukt") },
      { status: 500 }
    );
  }
}

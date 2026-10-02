import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runFonioDialerTick } from "@/lib/fonio-dialer";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/fonio-dialer
 * Elke 2 min: vul Fonio tot max concurrent (default 3) binnen 08:00–22:00.
 * Auth: Authorization: Bearer CRON_SECRET
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
    const sb = getSupabaseAdmin();
    const result = await runFonioDialerTick(sb);
    return NextResponse.json(result, {
      status: result.ok || result.skipped ? 200 : 500,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Dialer mislukt" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { runWoensdagCommissieBatch } from "@/lib/netto-creditfactuur";
import { toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/woensdag-commissie
 * Elke woensdag: commissie vorige week (aanbetalingen + netto sales) versturen.
 *
 * Auth: Authorization: Bearer CRON_SECRET
 * Query: ?force=1 om ook buiten woensdag te draaien (handmatig).
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

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const now = new Date();
  const local = toZonedTime(now, AMSTERDAM_TZ);
  const isWednesday = local.getDay() === 3;

  if (!isWednesday && !force) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Alleen op woensdag (gebruik ?force=1 voor handmatige run)",
      weekday: local.getDay(),
    });
  }

  try {
    const sb = getSupabaseAdmin();
    const result = await runWoensdagCommissieBatch(sb, now);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: errMessage(e, "Woensdag-commissie mislukt") },
      { status: 500 }
    );
  }
}

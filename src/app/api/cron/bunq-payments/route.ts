import { NextResponse } from "next/server";
import { syncBunqPayments } from "@/lib/bunq/sync";
import { bunqConfigured } from "@/lib/bunq/client";

export const runtime = "nodejs";

/**
 * GET /api/cron/bunq-payments
 * Periodieke sync van bunq → facturen (backup naast webhook).
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

  const cfg = bunqConfigured();
  if (!cfg.ok) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: `Niet geconfigureerd: ${cfg.missing.join(", ")}`,
    });
  }

  const result = await syncBunqPayments({ pages: 2 });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

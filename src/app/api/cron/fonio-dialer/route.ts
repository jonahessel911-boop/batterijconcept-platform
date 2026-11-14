import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/cron/fonio-dialer
 * Uit de planning. Fonio belt niet meer; eigen mensen bellen vanuit de belbak.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    skipped: true,
    reason: "Fonio-kiezer staat uit. Bellen doen we zelf.",
  });
}

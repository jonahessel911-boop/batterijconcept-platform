import { NextRequest, NextResponse } from "next/server";
import { syncBunqPayments } from "@/lib/bunq/sync";

export const runtime = "nodejs";

/**
 * POST /api/webhook/bunq
 * bunq callback (MUTATION / PAYMENT). Trigger sync van recente betalingen.
 *
 * Registreer in bunq:
 *   notification_target = https://platform.batterijconcept.nl/api/webhook/bunq
 *   category = MUTATION (of PAYMENT)
 */
export async function POST(req: NextRequest) {
  // bunq verwacht snelle 200; sync async
  try {
    await req.json().catch(() => null);
  } catch {
    /* ignore */
  }

  // Fire-and-forget sync (niet blokkeren op callback-timeout)
  void syncBunqPayments({ pages: 1 }).catch((e) =>
    console.error("bunq webhook sync:", e)
  );

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/webhook/bunq",
    method: "POST",
    description: "bunq MUTATION/PAYMENT callback → sync openstaande facturen",
  });
}

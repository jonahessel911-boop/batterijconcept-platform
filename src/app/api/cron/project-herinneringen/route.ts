import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/cron/project-herinneringen
 * Schouw-/installatie-mails zijn uitgeschakeld — cron doet niets meer.
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

  return NextResponse.json({
    ok: true,
    skipped: true,
    reason: "Schouw- en installatie-mails zijn uitgeschakeld",
    schouw_herinneringen: 0,
    installatie_herinneringen: 0,
  });
}

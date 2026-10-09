import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { releaseBelClaim } from "@/lib/bel-claim";

export const runtime = "nodejs";

/**
 * POST /api/bel/release
 * Body: { lead_id?: string } — laat claim los (één lead of alle van mij).
 */
export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      lead_id?: string | null;
    };

    await releaseBelClaim(
      getSupabaseAdmin(),
      session.adviseurId,
      body.lead_id?.trim() || null
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Claim vrijgeven mislukt") },
      { status: 500 }
    );
  }
}

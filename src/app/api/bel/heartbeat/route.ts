import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { heartbeatBelClaim } from "@/lib/bel-claim";

export const runtime = "nodejs";

/** POST /api/bel/heartbeat  Body: { lead_id } — verleng soft claim. */
export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      lead_id?: string;
    };
    const leadId = body.lead_id?.trim() || "";
    if (!leadId) {
      return NextResponse.json({ error: "lead_id verplicht" }, { status: 400 });
    }

    const ok = await heartbeatBelClaim(
      getSupabaseAdmin(),
      session.adviseurId,
      leadId
    );
    return NextResponse.json({ ok });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Heartbeat mislukt") },
      { status: 500 }
    );
  }
}

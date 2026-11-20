import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { loadWfAdviseurSlots } from "@/lib/api-v1/wf-adviseur-slots";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";

export const runtime = "nodejs";

/** GET /api/wf-adviseur-slots?lead_id=…&project_id=… — alleen Acties. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("project_id")?.trim() || null;
  const leadId = sp.get("lead_id")?.trim() || null;
  if (!projectId && !leadId) {
    return NextResponse.json(
      { error: "project_id of lead_id is verplicht" },
      { status: 400 }
    );
  }

  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const sb = getSupabaseAdmin();
    const result = await loadWfAdviseurSlots(sb, {
      projectId,
      leadId,
      daysAhead: 16,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "WF-adviseur-slots laden mislukt") },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { buildAandachtspunten } from "@/lib/aandachtspunten";

export const runtime = "nodejs";

/** GET /api/rapportage/aandachtspunten?mode=week|month&week=YYYY-Www&month=YYYY-MM */
export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const sp = req.nextUrl.searchParams;
    const modeRaw = (sp.get("mode") || "week").toLowerCase();
    const mode = modeRaw === "month" ? "month" : "week";

    const sb = getSupabaseAdmin();
    const result = await buildAandachtspunten(sb, {
      mode,
      weekKey: sp.get("week"),
      monthYm: sp.get("month"),
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Aandachtspunten laden mislukt") },
      { status: 500 }
    );
  }
}

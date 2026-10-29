import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { buildMaandLeaderboard } from "@/lib/maand-leaderboard";
import { normalizeRol } from "@/lib/rollen";

export const runtime = "nodejs";

/**
 * GET /api/maand-leaderboard
 * Query: month=YYYY-MM (default: huidige kalendermaand)
 * Zichtbaar voor ingelogde adviseurs (+ admin / backoffice / sales_manager).
 */
export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const rol = normalizeRol(session.rol);
    if (
      rol !== "adviseur" &&
      rol !== "admin" &&
      rol !== "backoffice" &&
      rol !== "sales_manager"
    ) {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const month = req.nextUrl.searchParams.get("month")?.trim() || undefined;
    const sb = getSupabaseAdmin();
    const board = await buildMaandLeaderboard(sb, { monthKey: month });

    return NextResponse.json({
      ok: true,
      me_id: session.adviseurId,
      ...board,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Leaderboard laden mislukt") },
      { status: 500 }
    );
  }
}

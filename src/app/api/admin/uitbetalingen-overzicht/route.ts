import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";
import { buildUitbetalingProgress } from "@/lib/uitbetaling-progress";

export const runtime = "nodejs";

/** GET /api/admin/uitbetalingen-overzicht — commissie-progressie per adviseur/BO. */
export async function GET() {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    if (normalizeRol(session.rol) !== "admin") {
      return NextResponse.json({ error: "Alleen admin" }, { status: 403 });
    }

    const overzicht = await buildUitbetalingProgress(getSupabaseAdmin());
    return NextResponse.json({ ok: true, ...overzicht });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Uitbetalingen-overzicht laden mislukt") },
      { status: 500 }
    );
  }
}

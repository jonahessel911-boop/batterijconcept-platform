/**
 * GET /api/stuur — Action Board data per business-unit.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import { normalizeRol } from "@/lib/rollen";
import { buildStuurBoard } from "@/lib/stuur-board";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const rol = normalizeRol(session.rol);
    if (rol !== "admin" && rol !== "sales_manager" && rol !== "backoffice") {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const sb = getSupabaseAdmin();
    const board = await buildStuurBoard(sb);
    return NextResponse.json({ board });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Stuurboard laden mislukt") },
      { status: 500 }
    );
  }
}

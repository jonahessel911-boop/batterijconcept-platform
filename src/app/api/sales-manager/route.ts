import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { magSalesSturing, normalizeRol } from "@/lib/rollen";
import {
  buildSalesManagerDashboard,
  buildSalesManagerDetail,
  buildSalesManagerPopup,
  parseSalesManagerPeriod,
  type SalesManagerPeriodInput,
} from "@/lib/sales-manager";

export const runtime = "nodejs";

async function requireSalesManager() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return {
      error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }),
    };
  }
  const rol = normalizeRol(session.rol);
  if (!magSalesSturing(rol)) {
    return {
      error: NextResponse.json({ error: "Geen toegang" }, { status: 403 }),
    };
  }
  return { session };
}

function periodFromRequest(req: NextRequest): SalesManagerPeriodInput {
  const period = parseSalesManagerPeriod(
    req.nextUrl.searchParams.get("period")
  );
  const customStart =
    req.nextUrl.searchParams.get("from")?.trim() ||
    req.nextUrl.searchParams.get("customStart")?.trim() ||
    null;
  const customEnd =
    req.nextUrl.searchParams.get("to")?.trim() ||
    req.nextUrl.searchParams.get("customEnd")?.trim() ||
    null;
  return { period, customStart, customEnd };
}

/**
 * GET /api/sales-manager?period=last_week
 * GET /api/sales-manager?period=custom&from=2026-10-01&to=2026-10-15
 * GET /api/sales-manager?period=last_week&adviseur_id=…
 */
export async function GET(req: NextRequest) {
  const auth = await requireSalesManager();
  if (auth.error) return auth.error;

  const input = periodFromRequest(req);
  const adviseurId =
    req.nextUrl.searchParams.get("adviseur_id")?.trim() || null;
  const view = req.nextUrl.searchParams.get("view")?.trim() || null;

  try {
    const sb = getSupabaseAdmin();
    if (adviseurId && view === "popup") {
      const popup = await buildSalesManagerPopup(sb, adviseurId, input);
      if (!popup) {
        return NextResponse.json(
          { error: "Adviseur niet gevonden" },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, popup });
    }
    if (adviseurId) {
      const detail = await buildSalesManagerDetail(sb, adviseurId, input);
      if (!detail) {
        return NextResponse.json(
          { error: "Adviseur niet gevonden" },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, detail });
    }
    const data = await buildSalesManagerDashboard(sb, input);
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Sales Manager laden mislukt") },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { magSalesSturing, normalizeRol } from "@/lib/rollen";
import {
  buildSalesManagerDashboard,
  buildSalesManagerDetail,
  monthKeyAmsterdam,
  saveSalesManagerGoal,
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

/**
 * GET /api/sales-manager?month=2026-10
 * GET /api/sales-manager?month=2026-10&adviseur_id=…
 * Metrics + actiepunten, of individueel dashboard (tijdlijn + kaart).
 */
export async function GET(req: NextRequest) {
  const auth = await requireSalesManager();
  if (auth.error) return auth.error;

  const month =
    req.nextUrl.searchParams.get("month")?.trim() || monthKeyAmsterdam();
  const adviseurId =
    req.nextUrl.searchParams.get("adviseur_id")?.trim() || null;

  try {
    const sb = getSupabaseAdmin();
    if (adviseurId) {
      const detail = await buildSalesManagerDetail(sb, adviseurId, month);
      if (!detail) {
        return NextResponse.json(
          { error: "Adviseur niet gevonden" },
          { status: 404 }
        );
      }
      return NextResponse.json({
        ok: true,
        monthKey: month,
        detail,
      });
    }
    const data = await buildSalesManagerDashboard(sb, month);
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Sales Manager laden mislukt") },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/sales-manager
 * Body: { month: "2026-10", adviseur_id, conversie_doel_pct: number | null }
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireSalesManager();
  if (auth.error) return auth.error;

  let body: {
    month?: string;
    adviseur_id?: string;
    conversie_doel_pct?: number | string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const month = (body.month || monthKeyAmsterdam()).trim();
  const adviseurId = body.adviseur_id?.trim();
  if (!adviseurId) {
    return NextResponse.json(
      { error: "adviseur_id is verplicht" },
      { status: 400 }
    );
  }

  let doelPct: number | null = null;
  if (body.conversie_doel_pct != null && body.conversie_doel_pct !== "") {
    const n =
      typeof body.conversie_doel_pct === "string"
        ? Number(body.conversie_doel_pct.replace(",", "."))
        : Number(body.conversie_doel_pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return NextResponse.json(
        { error: "conversie_doel_pct moet 0–100 zijn" },
        { status: 400 }
      );
    }
    doelPct = n;
  }

  try {
    const sb = getSupabaseAdmin();
    await saveSalesManagerGoal(sb, {
      monthKey: month,
      adviseurId,
      doelPct,
    });
    const data = await buildSalesManagerDashboard(sb, month);
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Doel opslaan mislukt") },
      { status: 500 }
    );
  }
}

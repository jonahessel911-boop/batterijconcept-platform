import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { loadBestSlotsForLead } from "@/lib/api-v1/best-slots";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";

export const runtime = "nodejs";

/**
 * GET /api/best-slots?lead_id=…&limit=5&adviseur_id=…
 * Top momenten over adviseurs: reistijd → agenda-druk → conversie.
 * Adviseur-rol: altijd alleen eigen agenda (adviseur_id genegeerd/overschreven).
 */
export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get("lead_id")?.trim() || "";
  if (!leadId) {
    return NextResponse.json(
      { error: "lead_id is verplicht" },
      { status: 400 }
    );
  }

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") || "5");
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 5, 1), 10);
  const daysRaw = Number(req.nextUrl.searchParams.get("days") || "21");
  const daysAhead = Math.min(
    Math.max(Number.isFinite(daysRaw) ? daysRaw : 21, 1),
    60
  );

  let adviseurId =
    req.nextUrl.searchParams.get("adviseur_id")?.trim() || null;

  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (session && normalizeRol(session.rol) === "adviseur") {
      // Adviseur mag nooit slots van anderen zien/plannen.
      adviseurId = session.adviseurId;
    }

    const sb = getSupabaseAdmin();
    const result = await loadBestSlotsForLead(sb, {
      leadId,
      daysAhead,
      limit,
      adviseurId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status }
      );
    }
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      lead: result.lead,
      count: result.slots.length,
      slots: result.slots,
      note: result.note,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Beste slots laden mislukt") },
      { status: 500 }
    );
  }
}

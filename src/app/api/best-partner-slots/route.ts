import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { loadBestPartnerSlots } from "@/lib/api-v1/best-partner-slots";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";

export const runtime = "nodejs";

/**
 * GET /api/best-partner-slots
 *   ?project_id=…&soort=schouw|installatie&days=14&limit=8
 *   ?lead_id=…&partner_id=…&after=ISO
 */
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

  const soortRaw = (sp.get("soort") || "schouw").toLowerCase();
  if (soortRaw !== "schouw" && soortRaw !== "installatie") {
    return NextResponse.json(
      { error: "soort moet schouw of installatie zijn" },
      { status: 400 }
    );
  }

  const limitRaw = Number(sp.get("limit") || "8");
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 8, 1), 20);
  const daysRaw = Number(sp.get("days") || "14");
  const daysAhead = Math.min(
    Math.max(Number.isFinite(daysRaw) ? daysRaw : 14, 1),
    60
  );
  const partnerId = sp.get("partner_id")?.trim() || null;
  const after = sp.get("after")?.trim() || null;

  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const sb = getSupabaseAdmin();
    const result = await loadBestPartnerSlots(sb, {
      projectId,
      leadId,
      soort: soortRaw,
      daysAhead,
      limit,
      partnerId,
      afterIso: after,
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
      project_id: result.project_id,
      soort: result.soort,
      count: result.slots.length,
      slots: result.slots,
      note: result.note,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Beste partner-slots laden mislukt") },
      { status: 500 }
    );
  }
}

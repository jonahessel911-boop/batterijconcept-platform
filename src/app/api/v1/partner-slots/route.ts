/**
 * GET /api/v1/partner-slots
 * Moment-first schouw/installatie over montagepartners (API-key).
 *   ?project_id=…&soort=schouw|installatie&days=14&limit=8
 *   ?lead_id=…&partner_id=…
 */

import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireSalesOrAdminApiKey } from "@/lib/api-v1/auth";
import { loadBestPartnerSlots } from "@/lib/api-v1/best-partner-slots";
import { jsonErr, jsonOk, parseNum, pickStr } from "@/lib/api-v1/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = requireSalesOrAdminApiKey(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const projectId = pickStr(sp.get("project_id"), sp.get("projectId"));
  const leadId = pickStr(sp.get("lead_id"), sp.get("leadId"));
  if (!projectId && !leadId) {
    return jsonErr("project_id of lead_id is verplicht", 400);
  }

  const soortRaw = (pickStr(sp.get("soort")) || "schouw").toLowerCase();
  if (soortRaw !== "schouw" && soortRaw !== "installatie") {
    return jsonErr("soort moet schouw of installatie zijn", 400);
  }

  const daysAhead = Math.min(Math.max(parseNum(sp.get("days")) || 14, 1), 60);
  const limit = Math.min(Math.max(parseNum(sp.get("limit")) || 8, 1), 20);
  const partnerId = pickStr(sp.get("partner_id"), sp.get("partnerId"));
  const after = pickStr(sp.get("after"));

  try {
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
      return jsonErr(result.error, result.status, { detail: result.detail });
    }
    return jsonOk({
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
    return jsonErr(errMessage(e, "Partner-slots laden mislukt"), 500);
  }
}

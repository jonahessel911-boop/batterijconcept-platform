import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireApiKey } from "@/lib/api-v1/auth";
import { jsonErr, jsonOk, parseNum, pickStr } from "@/lib/api-v1/http";

export const runtime = "nodejs";

/** GET /api/v1/leads */
export async function GET(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const status = pickStr(sp.get("status"));
  const q = pickStr(sp.get("q"));
  const adviseurId = pickStr(sp.get("adviseur_id"));
  const limit = Math.min(Math.max(parseNum(sp.get("limit")) || 100, 1), 500);

  try {
    const sb = getSupabaseAdmin();
    let query = sb
      .from("leads")
      .select(
        "id, lead_number, naam, email, telefoon, status, postcode, plaats, straat, huisnummer, adviseur_id, created_at, updated_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);
    if (adviseurId) query = query.eq("adviseur_id", adviseurId);
    if (q) {
      query = query.or(
        `naam.ilike.%${q}%,email.ilike.%${q}%,telefoon.ilike.%${q}%,lead_number.ilike.%${q}%`
      );
    }

    const { data, error } = await query;
    if (error) {
      return jsonErr("Leads laden mislukt", 500, { detail: error.message });
    }

    return jsonOk({ ok: true, count: (data || []).length, leads: data || [] });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}

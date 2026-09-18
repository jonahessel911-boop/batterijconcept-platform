import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireApiKey } from "@/lib/api-v1/auth";
import { jsonErr, jsonOk, parseNum, pickStr } from "@/lib/api-v1/http";
import { serializeProject } from "@/lib/api-v1/serialize";
import { selectProjectFacturen } from "@/lib/factuur-query";
import type { Factuur, Project } from "@/types/database";

export const runtime = "nodejs";

const PROJECT_SELECT =
  "*, leads(naam, email, telefoon, lead_number, plaats)";

/** GET /api/v1/projecten */
export async function GET(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const status = pickStr(sp.get("status"));
  const leadId = pickStr(sp.get("lead_id"));
  const q = pickStr(sp.get("q"));
  const withFacturen = sp.get("include") === "facturen";
  const limit = Math.min(Math.max(parseNum(sp.get("limit")) || 100, 1), 500);

  try {
    const sb = getSupabaseAdmin();
    let query = sb
      .from("projecten")
      .select(PROJECT_SELECT)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);
    if (leadId) query = query.eq("lead_id", leadId);
    if (q) {
      query = query.or(
        `project_nummer.ilike.%${q}%,titel.ilike.%${q}%`
      );
    }

    const { data, error } = await query;
    if (error) {
      return jsonErr("Projecten laden mislukt", 500, { detail: error.message });
    }

    const projecten = (data || []) as Project[];
    const out = [];
    for (const p of projecten) {
      let facturen: Factuur[] = [];
      if (withFacturen) {
        const fac = await selectProjectFacturen(sb, p.id);
        facturen = (fac.data || []) as Factuur[];
      }
      out.push(serializeProject(p, { facturen }));
    }

    return jsonOk({ ok: true, count: out.length, projecten: out });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}

import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireApiKey } from "@/lib/api-v1/auth";
import { jsonErr, jsonOk } from "@/lib/api-v1/http";
import { selectProjectFacturen } from "@/lib/factuur-query";
import { serializeFactuur, serializeProject } from "@/lib/api-v1/serialize";
import type { Factuur, Project } from "@/types/database";

export const runtime = "nodejs";

/** GET /api/v1/leads/:id */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  try {
    const sb = getSupabaseAdmin();
    const { data: lead, error } = await sb
      .from("leads")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return jsonErr("Laden mislukt", 500, { detail: error.message });
    if (!lead) return jsonErr("Lead niet gevonden", 404);

    const [projectenRes, facturenRes, afsprakenRes] = await Promise.all([
      sb
        .from("projecten")
        .select("*, leads(naam, lead_number)")
        .eq("lead_id", id)
        .order("created_at", { ascending: false }),
      sb
        .from("facturen")
        .select("*")
        .eq("lead_id", id)
        .order("created_at", { ascending: false }),
      sb
        .from("afspraken")
        .select("id, start_at, end_at, status, soort, adviseur_id, titel")
        .eq("lead_id", id)
        .order("start_at", { ascending: false })
        .limit(50),
    ]);

    const projecten = (projectenRes.data || []) as Project[];
    const projectPayload = [];
    for (const p of projecten) {
      const fac = await selectProjectFacturen(sb, p.id);
      projectPayload.push(
        serializeProject(p, { facturen: (fac.data || []) as Factuur[] })
      );
    }

    return jsonOk({
      ok: true,
      lead,
      projecten: projectPayload,
      facturen: ((facturenRes.data || []) as Factuur[]).map(serializeFactuur),
      afspraken: afsprakenRes.data || [],
    });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}

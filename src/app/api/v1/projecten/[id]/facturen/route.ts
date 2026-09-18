import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireApiKey } from "@/lib/api-v1/auth";
import { jsonErr, jsonOk } from "@/lib/api-v1/http";
import { serializeFactuur } from "@/lib/api-v1/serialize";
import { selectProjectFacturen } from "@/lib/factuur-query";
import type { Factuur } from "@/types/database";

export const runtime = "nodejs";

/** GET /api/v1/projecten/:id/facturen */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  try {
    const sb = getSupabaseAdmin();
    const { data: project } = await sb
      .from("projecten")
      .select("id, project_nummer")
      .eq("id", id)
      .maybeSingle();
    if (!project) return jsonErr("Project niet gevonden", 404);

    const fac = await selectProjectFacturen(sb, id);
    if (fac.error) {
      return jsonErr("Facturen laden mislukt", 500, {
        detail: fac.error.message,
      });
    }
    const facturen = (fac.data || []) as Factuur[];

    return jsonOk({
      ok: true,
      project_id: id,
      project_nummer: project.project_nummer,
      count: facturen.length,
      facturen: facturen.map(serializeFactuur),
    });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}

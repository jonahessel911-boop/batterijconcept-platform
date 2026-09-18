import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireApiKey } from "@/lib/api-v1/auth";
import { jsonErr, jsonOk } from "@/lib/api-v1/http";
import { openstaandFromFacturen } from "@/lib/api-v1/serialize";
import { selectProjectFacturen } from "@/lib/factuur-query";
import type { Factuur } from "@/types/database";

export const runtime = "nodejs";

/** GET /api/v1/projecten/:id/openstaand */
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
      .select("id, project_nummer, status, lead_id")
      .eq("id", id)
      .maybeSingle();
    if (!project) return jsonErr("Project niet gevonden", 404);

    const fac = await selectProjectFacturen(sb, id);
    if (fac.error) {
      return jsonErr("Facturen laden mislukt", 500, {
        detail: fac.error.message,
      });
    }

    return jsonOk({
      ok: true,
      project_id: id,
      project_nummer: project.project_nummer,
      project_status: project.status,
      ...openstaandFromFacturen((fac.data || []) as Factuur[]),
    });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}

import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireApiKey } from "@/lib/api-v1/auth";
import { jsonErr, jsonOk, pickStr } from "@/lib/api-v1/http";
import { serializeProject } from "@/lib/api-v1/serialize";
import { selectProjectFacturen } from "@/lib/factuur-query";
import { PROJECT_STATUSES } from "@/lib/labels";
import type { Factuur, Project } from "@/types/database";

export const runtime = "nodejs";

const PROJECT_SELECT =
  "*, leads(naam, email, telefoon, lead_number, plaats)";

/** GET /api/v1/projecten/:id */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("projecten")
      .select(PROJECT_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (error) return jsonErr("Laden mislukt", 500, { detail: error.message });
    if (!data) return jsonErr("Project niet gevonden", 404);

    const fac = await selectProjectFacturen(sb, id);
    const facturen = (fac.data || []) as Factuur[];

    return jsonOk({
      ok: true,
      project: serializeProject(data as Project, { facturen }),
      facturen_count: facturen.length,
    });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}

/** PATCH /api/v1/projecten/:id */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonErr("Ongeldige JSON");
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!(PROJECT_STATUSES as readonly string[]).includes(status)) {
      return jsonErr("Ongeldige projectstatus", 400, {
        allowed: PROJECT_STATUSES,
      });
    }
    patch.status = status;
  }
  if (body.titel !== undefined) patch.titel = pickStr(body.titel) || null;
  if (body.notities !== undefined) {
    patch.notities = pickStr(body.notities) || null;
  }
  if (body.schouw_notities !== undefined) {
    patch.schouw_notities = pickStr(body.schouw_notities) || null;
  }
  if (body.installatie_notities !== undefined) {
    patch.installatie_notities = pickStr(body.installatie_notities) || null;
  }
  if (body.bel_schouw_aanbetaling_at !== undefined) {
    patch.bel_schouw_aanbetaling_at =
      pickStr(body.bel_schouw_aanbetaling_at) || new Date().toISOString();
  }
  if (body.financiering_geschakeld_at !== undefined) {
    patch.financiering_geschakeld_at =
      pickStr(body.financiering_geschakeld_at) || new Date().toISOString();
  }

  if (Object.keys(patch).length <= 1) {
    return jsonErr("Niets om bij te werken");
  }

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("projecten")
      .update(patch)
      .eq("id", id)
      .select(PROJECT_SELECT)
      .single();

    if (error || !data) {
      return jsonErr("Bijwerken mislukt", 500, { detail: error?.message });
    }

    const fac = await selectProjectFacturen(sb, id);
    return jsonOk({
      ok: true,
      project: serializeProject(data as Project, {
        facturen: (fac.data || []) as Factuur[],
      }),
    });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}

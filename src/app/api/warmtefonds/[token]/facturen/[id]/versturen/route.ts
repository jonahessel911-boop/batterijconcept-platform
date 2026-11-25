import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import { verstuurFactuurNaarKlant } from "@/lib/factuur-versturen";
import { isWarmtefondsPortalProject } from "@/lib/warmtefonds-portal";
import { requireWarmtefondsPortalOperator } from "@/lib/warmtefonds-portal-guard";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/** POST — verstuur klantfactuur (concept-restant) vanuit het WF-portaal. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await ctx.params;
  try {
    const access = await requireWarmtefondsPortalOperator(req, token);
    if ("error" in access) return access.error;
    const sb = getSupabaseAdmin();

    const { data: factuur, error } = await sb
      .from("facturen")
      .select("id, project_id, status")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!factuur?.project_id) {
      return NextResponse.json(
        { error: "Factuur niet gevonden" },
        { status: 404 }
      );
    }

    const { data: project, error: projErr } = await sb
      .from("projecten")
      .select(
        "id, betaalwijze, financiering_status, offertes(financiering_voorbehoud)"
      )
      .eq("id", factuur.project_id)
      .maybeSingle();
    if (projErr) throw projErr;
    if (!project || !isWarmtefondsPortalProject(project)) {
      return NextResponse.json(
        { error: "Factuur hoort niet bij dit portaal" },
        { status: 404 }
      );
    }

    const result = await verstuurFactuurNaarKlant(id);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Verzenden mislukt" },
        { status: result.status || 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      factuur: result.factuur,
      messageId: result.messageId ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verzenden mislukt") },
      { status: 500 }
    );
  }
}

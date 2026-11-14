import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import { verstuurFactuurNaarKlant } from "@/lib/factuur-versturen";
import {
  isWarmtefondsPortalProject,
  resolveWarmtefondsOperator,
} from "@/lib/warmtefonds-portal";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/** POST — verstuur klantfactuur (concept-restant) vanuit het WF-portaal. */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

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

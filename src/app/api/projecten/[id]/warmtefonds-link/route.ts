import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { appBaseUrl } from "@/lib/email/postmark";
import { isWarmtefondsPortalProject } from "@/lib/warmtefonds-portal";

export const runtime = "nodejs";

/**
 * GET /api/projecten/[id]/warmtefonds-link
 * Geeft de Warmtefonds-portaal-URL voor dit project (via actieve operator).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: project, error } = await sb
      .from("projecten")
      .select("id, project_nummer, betaalwijze, financiering_status, status")
      .eq("id", id)
      .single();

    if (error || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }

    if (!isWarmtefondsPortalProject(project)) {
      return NextResponse.json(
        { error: "Dit project is geen Warmtefonds-aanvraag" },
        { status: 400 }
      );
    }

    const { data: operators, error: opErr } = await sb
      .from("warmtefonds_operators")
      .select("id, naam, portal_token, actief")
      .eq("actief", true)
      .order("naam")
      .limit(1);

    if (opErr) {
      if (
        opErr.code === "42P01" ||
        opErr.message?.includes("warmtefonds_operators")
      ) {
        return NextResponse.json(
          {
            error:
              "Warmtefonds-operators ontbreken — draai migrate-warmtefonds-portaal.sql",
          },
          { status: 503 }
        );
      }
      throw opErr;
    }

    const operator = operators?.[0];
    if (!operator?.portal_token) {
      return NextResponse.json(
        {
          error:
            "Geen actieve Warmtefonds-operator. Maak er eerst een aan via /api/warmtefonds-operators.",
        },
        { status: 404 }
      );
    }

    const url = `${appBaseUrl()}/warmtefonds/${operator.portal_token}/orders/${id}`;
    return NextResponse.json({
      url,
      portal_token: operator.portal_token,
      operator_id: operator.id,
      operator_naam: operator.naam,
      project_id: id,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

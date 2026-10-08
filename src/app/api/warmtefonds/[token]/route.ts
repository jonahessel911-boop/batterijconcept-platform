import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  isMissingWfProjectColumn,
  isWarmtefondsPortalProject,
  resolveWarmtefondsOperator,
  WF_PORTAL_PROJECT_SELECT,
  WF_PORTAL_PROJECT_SELECT_MIN,
} from "@/lib/warmtefonds-portal";

export const runtime = "nodejs";

/** GET /api/warmtefonds/[token] — operator + Warmtefonds-aanvragen */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const primary = await sb
      .from("projecten")
      .select(WF_PORTAL_PROJECT_SELECT)
      .neq("status", "annulering")
      .order("warmtefonds_afspraak_at", {
        ascending: true,
        nullsFirst: false,
      });

    let rows: unknown[] | null = primary.data;
    let error = primary.error;

    if (error && isMissingWfProjectColumn(error)) {
      const fallback = await sb
        .from("projecten")
        .select(WF_PORTAL_PROJECT_SELECT_MIN)
        .neq("status", "annulering")
        .order("warmtefonds_afspraak_at", {
          ascending: true,
          nullsFirst: false,
        });
      if (fallback.error && isMissingWfProjectColumn(fallback.error)) {
        const bare = await sb
          .from("projecten")
          .select(
            `
            id, project_nummer, titel, status, betaalwijze, lead_id, offerte_id,
            notities, created_at, updated_at,
            leads(
              id, naam, email, telefoon, lead_number,
              postcode, huisnummer, toevoeging, straat, plaats, notities
            ),
            offertes(id, offerte_nummer, status, ondertekend_op, financiering_voorbehoud)
          `
          )
          .neq("status", "annulering")
          .order("created_at", { ascending: false });
        if (bare.error) throw bare.error;
        rows = bare.data;
        error = null;
      } else if (fallback.error) {
        throw fallback.error;
      } else {
        rows = fallback.data;
        error = null;
      }
    }

    if (error) throw error;

    const orders = ((rows || []) as Parameters<
      typeof isWarmtefondsPortalProject
    >[0][]).filter(isWarmtefondsPortalProject);

    return NextResponse.json({
      operator: {
        id: operator.id,
        naam: operator.naam,
        email: operator.email,
      },
      orders,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

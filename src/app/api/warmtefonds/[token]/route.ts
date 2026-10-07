import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  isWarmtefondsPortalProject,
  resolveWarmtefondsOperator,
  WF_PORTAL_PROJECT_SELECT,
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

    const { data: rows, error } = await sb
      .from("projecten")
      .select(WF_PORTAL_PROJECT_SELECT)
      .neq("status", "annulering")
      .order("warmtefonds_afspraak_at", {
        ascending: true,
        nullsFirst: false,
      });

    if (error) {
      // Kolom warmtefonds_notities ontbreekt mogelijk vóór migratie
      if (
        error.code === "42703" ||
        error.message?.includes("warmtefonds_notities")
      ) {
        const fallback = await sb
          .from("projecten")
          .select(
            `
            id, project_nummer, titel, status, betaalwijze, lead_id, offerte_id,
            financiering_status, warmtefonds_afspraak_at, warmtefonds_aangevraagd_at,
            notities, created_at, updated_at,
            leads(
              id, naam, email, telefoon, lead_number,
              postcode, huisnummer, toevoeging, straat, plaats, notities
            ),
            offertes(id, offerte_nummer, status, ondertekend_op, financiering_voorbehoud)
          `
          )
          .neq("status", "annulering")
          .order("warmtefonds_afspraak_at", {
            ascending: true,
            nullsFirst: false,
          });
        if (fallback.error) throw fallback.error;
        const orders = (fallback.data || []).filter(isWarmtefondsPortalProject);
        return NextResponse.json({
          operator: {
            id: operator.id,
            naam: operator.naam,
            email: operator.email,
          },
          orders,
        });
      }
      throw error;
    }

    const orders = (rows || []).filter(isWarmtefondsPortalProject);

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

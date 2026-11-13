import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  portalViewerPayload,
  resolveInstallatiePortal,
  scopesToOwnJobsOnly,
} from "@/lib/installatie-portal";

export const runtime = "nodejs";

/** GET /api/installatie/[token] — partner/beheerder of monteur + orderslijst */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const session = await resolveInstallatiePortal(token, req);
    if (!session) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const sb = getSupabaseAdmin();
    let query = sb
      .from("projecten")
      .select(
        "id, project_nummer, titel, status, schouw_at, schouw_jaar, schouw_week, schouw_notities, installatie_at, installatie_notities, notities, monteur, installatie_teamgenoot_id, materiaal_checks, startdatum, opleverdatum, created_at, leads(naam, telefoon, email, postcode, huisnummer, toevoeging, straat, plaats, lead_number)"
      )
      .eq("installatie_partner_id", session.partner.id)
      .order("schouw_at", { ascending: true, nullsFirst: false });

    if (scopesToOwnJobsOnly(session)) {
      query = query.eq("installatie_teamgenoot_id", session.teamgenoot.id);
    }

    const { data: orders, error } = await query;

    if (error) {
      if (
        scopesToOwnJobsOnly(session) &&
        (error.message?.includes("installatie_teamgenoot_id") ||
          error.code === "42703")
      ) {
        return NextResponse.json({
          ...portalViewerPayload(session),
          partner: {
            id: session.partner.id,
            naam: session.partner.naam,
            email: session.partner.email,
          },
          orders: [],
          hint: "Voer migrate-project-installatie-teamgenoot.sql uit.",
        });
      }
      throw error;
    }

    return NextResponse.json({
      ...portalViewerPayload(session),
      partner: {
        id: session.partner.id,
        naam: session.partner.naam,
        email: session.partner.email,
      },
      orders: orders || [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

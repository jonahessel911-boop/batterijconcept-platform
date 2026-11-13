import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  resolveInstallatiePortal,
  scopesToOwnJobsOnly,
} from "@/lib/installatie-portal";

export const runtime = "nodejs";

/**
 * GET — monteur: eigen afgeronde installaties + scores (read-only).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const session = await resolveInstallatiePortal(token, req);
    if (!session || !scopesToOwnJobsOnly(session)) {
      return NextResponse.json(
        { error: "Alleen voor monteurs" },
        { status: 403 }
      );
    }

    const tgId = session.teamgenoot.id;
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("projecten")
      .select(
        `id, project_nummer, titel, status, installatie_at, installatie_voltooid_at,
         monteur_beoordeling_sterren, monteur_beoordeling_notitie,
         monteur_beoordeling_op, monteur_beoordeling_door,
         klantvriendelijkheid_sterren, klantvriendelijkheid_notitie,
         klantvriendelijkheid_op, klantvriendelijkheid_door,
         leads(naam, plaats)`
      )
      .eq("installatie_partner_id", session.partner.id)
      .eq("installatie_teamgenoot_id", tgId)
      .or(
        "installatie_voltooid_at.not.is.null,status.in.(installatie_voltooid,review_gevraagd,afgerond,service)"
      )
      .order("installatie_at", { ascending: false, nullsFirst: false });

    if (error) throw error;

    return NextResponse.json({
      teamgenoot: {
        id: session.teamgenoot.id,
        naam: session.teamgenoot.naam,
      },
      installaties: data || [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Beoordelingen laden mislukt") },
      { status: 500 }
    );
  }
}

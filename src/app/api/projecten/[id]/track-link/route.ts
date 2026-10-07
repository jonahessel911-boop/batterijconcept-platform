import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { ensureOfferteTrackToken } from "@/lib/ensure-track-token";
import { appBaseUrl } from "@/lib/email/postmark";

export const runtime = "nodejs";

/**
 * GET /api/projecten/[id]/track-link
 * Geeft (en maakt indien nodig) de klant track & trace-URL terug.
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
      .select(
        "id, offerte_id, offertes(id, track_token, status)"
      )
      .eq("id", id)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: "Project niet gevonden" }, { status: 404 });
    }

    type OffLite = {
      id: string;
      track_token?: string | null;
      status?: string;
    };
    const offJoin = Array.isArray(project.offertes)
      ? project.offertes[0]
      : project.offertes;
    let off: OffLite | null = (offJoin as OffLite | null) || null;

    if (!off?.id && project.offerte_id) {
      const { data: offRow } = await sb
        .from("offertes")
        .select("id, track_token, status")
        .eq("id", project.offerte_id)
        .maybeSingle();
      off = (offRow as OffLite | null) || null;
    }

    if (!off?.id) {
      return NextResponse.json(
        { error: "Geen offerte gekoppeld" },
        { status: 400 }
      );
    }

    const trackToken = await ensureOfferteTrackToken(
      sb,
      off.id,
      off.track_token
    );
    if (!trackToken) {
      return NextResponse.json(
        {
          error:
            "Track-token ontbreekt — draai migrate-track-token.sql in Supabase",
        },
        { status: 503 }
      );
    }

    const url = `${appBaseUrl()}/track/${trackToken}`;
    return NextResponse.json({
      url,
      track_token: trackToken,
      offerte_id: off.id,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

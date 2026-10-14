import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { ensureOfferteTrackToken } from "@/lib/ensure-track-token";
import { findBoOverstapSlots } from "@/lib/bo-overstap-slots";
import { toKlantDatumOptie, type ProjectDatumOptie } from "@/lib/project-datum-opties";

export const runtime = "nodejs";

/**
 * GET /api/track/[token]/overstap-slots
 * 10 vrije 30-min overstap-slots uit Taken-agenda (backoffice).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: offerte, error } = await sb
      .from("offertes")
      .select("id, lead_id, track_token, status")
      .eq("track_token", token)
      .maybeSingle();

    if (error) {
      if (error.code === "42703" || error.message?.includes("track_token")) {
        return NextResponse.json(
          { error: "Track & trace is nog niet beschikbaar" },
          { status: 503 }
        );
      }
      throw error;
    }
    if (!offerte || offerte.status !== "ondertekend") {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }

    const trackToken = await ensureOfferteTrackToken(
      sb,
      offerte.id,
      offerte.track_token
    );
    if (!trackToken) {
      return NextResponse.json(
        { error: "Track & trace is nog niet beschikbaar" },
        { status: 503 }
      );
    }

    // Exclude de 3 voorgestelde slots uit open overstap-uitnodiging
    let exclude: string[] = [];
    let { data: project } = await sb
      .from("projecten")
      .select("id")
      .eq("offerte_id", offerte.id)
      .maybeSingle();
    if (!project) {
      const { data: byLead } = await sb
        .from("projecten")
        .select("id")
        .eq("lead_id", offerte.lead_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      project = byLead;
    }
    if (project?.id) {
      const { data: opt } = await sb
        .from("project_datum_opties")
        .select("*")
        .eq("project_id", project.id)
        .eq("soort", "overstap")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (opt) {
        const k = toKlantDatumOptie(opt as ProjectDatumOptie);
        exclude = [...k.slots];
      }
    }

    const slots = await findBoOverstapSlots(sb, {
      limit: 10,
      daysAhead: 21,
      excludeStarts: exclude,
    });

    return NextResponse.json({
      slots,
      duur_minuten: 30,
      opening: "09:00–17:00 · lunch 12:00–12:30 geblokkeerd",
    });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

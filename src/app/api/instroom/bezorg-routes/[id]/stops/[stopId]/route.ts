import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; stopId: string }> };

/** Krabbel zetten bij levering. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id: routeId, stopId } = await ctx.params;
    const sb = getSupabaseAdmin();
    const body = (await req.json()) as {
      handtekening_data_url?: string | null;
      ontvanger_naam?: string | null;
      geleverd?: boolean;
    };

    const ontvanger = (body.ontvanger_naam || "").trim();
    const sig = (body.handtekening_data_url || "").trim();

    if (body.geleverd !== false) {
      if (!ontvanger) {
        return NextResponse.json(
          { error: "Naam ontvanger is verplicht" },
          { status: 400 }
        );
      }
      if (!sig.startsWith("data:image")) {
        return NextResponse.json(
          { error: "Krabbel (handtekening) is verplicht" },
          { status: 400 }
        );
      }
    }

    const patch: Record<string, unknown> = {
      ontvanger_naam: ontvanger || null,
      handtekening_data_url: sig || null,
      geleverd_at:
        body.geleverd === false ? null : new Date().toISOString(),
    };

    const { data: stop, error } = await sb
      .from("bezorg_route_stops")
      .update(patch)
      .eq("id", stopId)
      .eq("route_id", routeId)
      .select("*")
      .single();
    if (error) throw error;

    // Route afronden als alle stops getekend zijn
    const { data: allStops } = await sb
      .from("bezorg_route_stops")
      .select("id, geleverd_at")
      .eq("route_id", routeId);

    const allDone =
      (allStops || []).length > 0 &&
      (allStops || []).every((s) => Boolean(s.geleverd_at));

    if (allDone) {
      await sb
        .from("bezorg_routes")
        .update({
          status: "afgerond",
          updated_at: new Date().toISOString(),
        })
        .eq("id", routeId);
    } else {
      await sb
        .from("bezorg_routes")
        .update({
          status: "onderweg",
          updated_at: new Date().toISOString(),
        })
        .eq("id", routeId)
        .neq("status", "afgerond");
    }

    return NextResponse.json({
      stop,
      route_status: allDone ? "afgerond" : "onderweg",
    });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

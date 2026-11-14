import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { logLeadEvent } from "@/lib/lead-events";

export const runtime = "nodejs";

/** GET /api/leads/[id]/events — tijdlijn */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("lead_events")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      if (
        error.code === "42P01" ||
        error.message?.includes("lead_events")
      ) {
        return NextResponse.json({
          events: [],
          hint: "Voer supabase/migrate-platform-verbeteringen.sql uit",
        });
      }
      throw error;
    }
    return NextResponse.json({ events: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Events laden mislukt") },
      { status: 500 }
    );
  }
}

/** POST /api/leads/[id]/events — log gebeurtenis */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    soort?: string;
    titel?: string;
    detail?: string | null;
    meta?: Record<string, unknown> | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }
  if (!body.titel?.trim()) {
    return NextResponse.json({ error: "titel is verplicht" }, { status: 400 });
  }
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    const baseMeta =
      body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)
        ? { ...body.meta }
        : {};
    if (session?.adviseurId) {
      if (baseMeta.adviseur_id == null) {
        baseMeta.adviseur_id = session.adviseurId;
      }
      if (baseMeta.adviseur_naam == null && session.naam) {
        baseMeta.adviseur_naam = session.naam;
      }
    }
    await logLeadEvent({
      leadId: id,
      soort: body.soort || "overig",
      titel: body.titel.trim(),
      detail: body.detail,
      meta: Object.keys(baseMeta).length > 0 ? baseMeta : body.meta,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Event opslaan mislukt") },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  buildGoogleAuthUrl,
  googleCalendarConfigured,
} from "@/lib/google-calendar";

export const runtime = "nodejs";

/**
 * GET /api/installatie-partners/[id]/google/connect
 * Start OAuth: monteur/BO logt in bij Google → agenda-rechten.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    if (!googleCalendarConfigured()) {
      return NextResponse.json(
        {
          error:
            "Google Calendar OAuth niet geconfigureerd. Zet GOOGLE_CALENDAR_CLIENT_ID en GOOGLE_CALENDAR_CLIENT_SECRET.",
        },
        { status: 503 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data: partner, error } = await sb
      .from("installatie_partners")
      .select("id, actief")
      .eq("id", id)
      .single();

    if (error || !partner || !partner.actief) {
      return NextResponse.json(
        { error: "Partner niet gevonden" },
        { status: 404 }
      );
    }

    const url = buildGoogleAuthUrl(partner.id);
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "OAuth starten mislukt") },
      { status: 500 }
    );
  }
}

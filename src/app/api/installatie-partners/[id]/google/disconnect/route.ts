import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

/** POST /api/installatie-partners/[id]/google/disconnect */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from("installatie_partners")
      .update({
        google_refresh_token: null,
        google_access_token: null,
        google_token_expires_at: null,
        google_connected_email: null,
        google_connected_at: null,
      })
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Ontkoppelen mislukt") },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

/** GET /api/installatie-partners/teamgenoten?partner_id= */
export async function GET(req: NextRequest) {
  const partnerId = req.nextUrl.searchParams.get("partner_id")?.trim();
  if (!partnerId) {
    return NextResponse.json(
      { error: "partner_id is verplicht" },
      { status: 400 }
    );
  }
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("installatie_partner_teamgenoten")
      .select(
        "id, partner_id, naam, email, telefoon, actief, created_at, updated_at"
      )
      .eq("partner_id", partnerId)
      .order("naam");

    if (error) {
      if (
        error.code === "42P01" ||
        error.message?.includes("installatie_partner_teamgenoten")
      ) {
        return NextResponse.json({ teamgenoten: [], migration_required: true });
      }
      throw error;
    }

    return NextResponse.json({
      teamgenoten: (data || []).filter((t) => t.actief !== false),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Teamgenoten laden mislukt") },
      { status: 500 }
    );
  }
}

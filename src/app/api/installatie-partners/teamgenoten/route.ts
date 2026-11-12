import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

const SELECT_FULL =
  "id, partner_id, naam, email, telefoon, actief, rol, kan_schouw, kan_installatie, leeftijd, merken_ervaring, foto_storage_path, dossier_compleet, created_at, updated_at";
const SELECT_MIN =
  "id, partner_id, naam, email, telefoon, actief, created_at, updated_at";

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
    const full = await sb
      .from("installatie_partner_teamgenoten")
      .select(SELECT_FULL)
      .eq("partner_id", partnerId)
      .order("naam");

    let rows = full.data as Record<string, unknown>[] | null;
    let error = full.error;

    if (
      error &&
      (error.code === "42703" ||
        error.message?.includes("kan_schouw") ||
        error.message?.includes("rol") ||
        error.message?.includes("merken_ervaring"))
    ) {
      const soft = await sb
        .from("installatie_partner_teamgenoten")
        .select(SELECT_MIN)
        .eq("partner_id", partnerId)
        .order("naam");
      rows = soft.data as Record<string, unknown>[] | null;
      error = soft.error;
    }

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
      teamgenoten: (rows || []).filter((t) => t.actief !== false),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Teamgenoten laden mislukt") },
      { status: 500 }
    );
  }
}

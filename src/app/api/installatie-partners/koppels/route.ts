import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

const SELECT =
  "id, partner_id, naam, monteur_1_id, monteur_2_id, beoordeling_sterren, beoordeling_notitie, actief, created_at, updated_at, monteur_1:installatie_partner_teamgenoten!monteur_1_id(id, naam, email, actief, kan_installatie), monteur_2:installatie_partner_teamgenoten!monteur_2_id(id, naam, email, actief, kan_installatie)";
const SELECT_FLAT =
  "id, partner_id, naam, monteur_1_id, monteur_2_id, beoordeling_sterren, beoordeling_notitie, actief, created_at, updated_at";

function isMissing(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST205" ||
    msg.includes("installatie_partner_koppels") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

/** GET /api/installatie-partners/koppels?partner_id= */
export async function GET(req: NextRequest) {
  const partnerId = req.nextUrl.searchParams.get("partner_id")?.trim() || "";
  try {
    const sb = getSupabaseAdmin();
    let q = sb.from("installatie_partner_koppels").select(SELECT).order("naam");
    if (partnerId) q = q.eq("partner_id", partnerId);
    let { data, error } = await q;

    if (error && isMissing(error)) {
      return NextResponse.json({ koppels: [], migration_required: true });
    }
    if (error) {
      let flatQ = sb
        .from("installatie_partner_koppels")
        .select(SELECT_FLAT)
        .order("naam");
      if (partnerId) flatQ = flatQ.eq("partner_id", partnerId);
      const flat = await flatQ;
      data = flat.data as typeof data;
      error = flat.error;
      if (error && isMissing(error)) {
        return NextResponse.json({ koppels: [], migration_required: true });
      }
      if (error) throw error;
    }

    return NextResponse.json({
      koppels: (data || []).filter((k) => k.actief !== false),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Koppels laden mislukt") },
      { status: 500 }
    );
  }
}

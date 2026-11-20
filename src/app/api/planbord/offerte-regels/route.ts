import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PlanbordOfferteRegel = {
  offerte_id: string;
  omschrijving: string | null;
  aantal: number | null;
  prijs_ex_btw: number | null;
  sort_order: number | null;
};

/** GET /api/planbord/offerte-regels?ids=uuid,uuid */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("ids") || "";
  const ids = [
    ...new Set(
      raw
        .split(",")
        .map((id) => id.trim())
        .filter((id) => UUID_RE.test(id))
    ),
  ].slice(0, 200);
  if (ids.length === 0) {
    return NextResponse.json({ regels: [] });
  }
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("offerte_regels")
      .select("offerte_id, omschrijving, aantal, prijs_ex_btw, sort_order")
      .in("offerte_id", ids);
    if (error) throw error;
    return NextResponse.json({ regels: (data || []) as PlanbordOfferteRegel[] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

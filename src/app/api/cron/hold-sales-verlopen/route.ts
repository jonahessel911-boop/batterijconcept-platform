import { NextResponse } from "next/server";
import { verwerkVerlopenHoldSales } from "@/lib/hold-sales";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * GET /api/cron/hold-sales-verlopen
 * Rapportage: hoeveel HOLDs zijn de sales-deadline voorbij.
 * Geen auto-annulering — BO ziet Actie «HOLD sales verlopen».
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const q = new URL(req.url).searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await verwerkVerlopenHoldSales(getSupabaseAdmin());
    return NextResponse.json({
      ok: true,
      verlopen: result.verwerkt.length,
      projecten: result.verwerkt,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

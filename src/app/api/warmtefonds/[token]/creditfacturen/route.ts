import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { resolveWarmtefondsOperator } from "@/lib/warmtefonds-portal";
import { lijstEdergyFacturen } from "@/lib/edergy-factuur";

export const runtime = "nodejs";

/** GET /api/warmtefonds/[token]/creditfacturen */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const operator = await resolveWarmtefondsOperator(getSupabaseAdmin(), token);
    if (!operator) {
      return NextResponse.json({ error: "Portaal niet gevonden" }, { status: 404 });
    }
    const facturen = await lijstEdergyFacturen();
    return NextResponse.json({ facturen });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

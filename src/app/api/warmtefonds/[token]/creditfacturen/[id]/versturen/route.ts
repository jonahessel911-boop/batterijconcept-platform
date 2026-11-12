import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import { verstuurEdergyFactuur } from "@/lib/edergy-factuur";
import { resolveWarmtefondsOperator } from "@/lib/warmtefonds-portal";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/** POST — verstuur Edergy-creditfactuur naar BatterijConcept. */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json({ error: "Portaal niet gevonden" }, { status: 404 });
    }

    const result = await verstuurEdergyFactuur({ factuurId: id });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Verzenden mislukt" },
        { status: result.error === "Factuur niet gevonden" ? 404 : 400 }
      );
    }

    return NextResponse.json({ ok: true, factuur: result.factuur });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verzenden mislukt") },
      { status: 500 }
    );
  }
}

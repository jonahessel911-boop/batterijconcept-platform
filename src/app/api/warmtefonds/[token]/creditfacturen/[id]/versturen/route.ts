import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import { verstuurEdergyFactuur } from "@/lib/edergy-factuur";
import { requireWarmtefondsPortalOperator } from "@/lib/warmtefonds-portal-guard";

export const runtime = "nodejs";

/** POST — verstuur Edergy-creditfactuur naar BatterijConcept. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await ctx.params;
  try {
    const access = await requireWarmtefondsPortalOperator(req, token);
    if ("error" in access) return access.error;

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

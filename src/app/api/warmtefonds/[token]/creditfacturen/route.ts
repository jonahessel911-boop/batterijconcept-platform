import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import { requireWarmtefondsPortalOperator } from "@/lib/warmtefonds-portal-guard";
import { lijstEdergyFacturen } from "@/lib/edergy-factuur";

export const runtime = "nodejs";

/** GET /api/warmtefonds/[token]/creditfacturen */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const access = await requireWarmtefondsPortalOperator(req, token);
    if ("error" in access) return access.error;
    const facturen = await lijstEdergyFacturen();
    return NextResponse.json({ facturen });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveWarmtefondsOperator } from "@/lib/warmtefonds-portal";
import { loadWarmtefondsBestSlots } from "@/lib/warmtefonds-slots";

export const runtime = "nodejs";

/**
 * GET /api/warmtefonds/[token]/best-slots?projectId=…&days=14&limit=8
 * Slimme WF-slots obv. Warmtefonds-agenda + reistijd.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is verplicht" },
        { status: 400 }
      );
    }

    const days = Number(req.nextUrl.searchParams.get("days") || 14);
    const limit = Number(req.nextUrl.searchParams.get("limit") || 8);

    const result = await loadWarmtefondsBestSlots(sb, {
      projectId,
      days: Number.isFinite(days) ? days : 14,
      limit: Number.isFinite(limit) ? limit : 8,
    });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Slots laden mislukt") },
      { status: 500 }
    );
  }
}

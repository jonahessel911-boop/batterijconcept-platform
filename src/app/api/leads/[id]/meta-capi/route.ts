import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import { syncLeadMetaCapi } from "@/lib/meta-capi";
import { syncLeadTikTokEvents } from "@/lib/tiktok-events";

export const runtime = "nodejs";

/**
 * POST /api/leads/[id]/meta-capi
 * Sync Meta Conversions API én TikTok Events API voor deze lead (cumulatief).
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const result = await syncLeadMetaCapi(id);
    const tiktok = await syncLeadTikTokEvents(id);
    return NextResponse.json({ ...result, tiktok });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Meta CAPI sync mislukt") },
      { status: 500 }
    );
  }
}

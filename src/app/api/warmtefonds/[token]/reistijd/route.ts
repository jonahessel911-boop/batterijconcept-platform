import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildDurationMap } from "@/lib/travel-time";
import { resolveWarmtefondsOperator } from "@/lib/warmtefonds-portal";

export const runtime = "nodejs";

type LegIn = { id?: unknown; from?: unknown; to?: unknown };

/**
 * POST /api/warmtefonds/[token]/reistijd
 * Zelfde routeberekening als de adviseursagenda (travelTimeBetween).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const operator = await resolveWarmtefondsOperator(
      getSupabaseAdmin(),
      token
    );
    if (!operator) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as { legs?: LegIn[] };
    const legs = (Array.isArray(body.legs) ? body.legs : [])
      .slice(0, 120)
      .map((leg) => ({
        id: typeof leg.id === "string" ? leg.id : "",
        from: typeof leg.from === "string" ? leg.from.trim() : "",
        to: typeof leg.to === "string" ? leg.to.trim() : "",
      }))
      .filter(
        (leg) =>
          leg.id && leg.from && leg.to && leg.from !== "—" && leg.to !== "—"
      );

    const { durationMap } = await buildDurationMap(
      legs.flatMap((leg) => [leg.from, leg.to])
    );
    const out: { id: string; durationSec: number }[] = [];
    for (const leg of legs) {
      const sec = durationMap.get(`${leg.from}|||${leg.to}`);
      if (sec == null) continue;
      out.push({ id: leg.id, durationSec: sec });
    }

    return NextResponse.json({ legs: out });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Reistijd mislukt") },
      { status: 500 }
    );
  }
}

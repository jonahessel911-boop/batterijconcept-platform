import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import { requirePartnerPortal } from "@/lib/installatie-portal";
import {
  buildDurationMap,
  formatDurationNl,
} from "@/lib/travel-time";

export const runtime = "nodejs";

type LegIn = { id?: unknown; from?: unknown; to?: unknown };

/**
 * POST — reistijd tussen pipeline-orders (per week/regio).
 * Body: { legs: [{ id, from, to }] }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await requirePartnerPortal(token, req);
    if (!partner) {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { legs?: LegIn[] };
    const legs = (Array.isArray(body.legs) ? body.legs : [])
      .slice(0, 80)
      .map((leg) => ({
        id: typeof leg.id === "string" ? leg.id : "",
        from: typeof leg.from === "string" ? leg.from.trim() : "",
        to: typeof leg.to === "string" ? leg.to.trim() : "",
      }))
      .filter(
        (leg) =>
          leg.id && leg.from && leg.to && leg.from !== "—" && leg.to !== "—"
      );

    if (legs.length === 0) {
      return NextResponse.json({ legs: [] });
    }

    const { durationMap } = await buildDurationMap(
      legs.flatMap((leg) => [leg.from, leg.to])
    );

    const out: {
      id: string;
      durationSec: number;
      durationText: string;
    }[] = [];

    for (const leg of legs) {
      const sec = durationMap.get(`${leg.from}|||${leg.to}`);
      if (sec == null) continue;
      out.push({
        id: leg.id,
        durationSec: sec,
        durationText: formatDurationNl(sec),
      });
    }

    return NextResponse.json({ legs: out });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Reistijd laden mislukt") },
      { status: 500 }
    );
  }
}

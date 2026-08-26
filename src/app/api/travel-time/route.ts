import { NextRequest, NextResponse } from "next/server";
import {
  travelErrorMessage,
  travelTimeBetween,
} from "@/lib/travel-time";

export const runtime = "nodejs";

/**
 * GET /api/travel-time?from=...&to=...
 * Google Distance Matrix, anders Geocoding + OSRM / schatting.
 */
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from")?.trim() || "";
  const to = req.nextUrl.searchParams.get("to")?.trim() || "";
  if (!from || !to) {
    return NextResponse.json(
      { error: "from en to zijn verplicht", available: false },
      { status: 400 }
    );
  }

  try {
    const leg = await travelTimeBetween(from, to);
    return NextResponse.json({
      available: true,
      durationText: leg.durationText,
      durationSec: leg.durationSec,
      distanceText: leg.distanceText,
      distanceM: leg.distanceM,
      provider: leg.provider,
    });
  } catch (e) {
    return NextResponse.json(
      { error: travelErrorMessage(e), available: false },
      { status: 404 }
    );
  }
}

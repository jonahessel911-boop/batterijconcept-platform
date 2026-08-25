import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

/** GET /api/travel-time?from=...&to=... — reistijd auto (Google Distance Matrix) */
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from")?.trim() || "";
  const to = req.nextUrl.searchParams.get("to")?.trim() || "";
  if (!from || !to) {
    return NextResponse.json(
      { error: "from en to zijn verplicht" },
      { status: 400 }
    );
  }

  const key =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY ontbreekt", available: false },
      { status: 503 }
    );
  }

  try {
    const url = new URL(
      "https://maps.googleapis.com/maps/api/distancematrix/json"
    );
    url.searchParams.set("origins", from);
    url.searchParams.set("destinations", to);
    url.searchParams.set("mode", "driving");
    url.searchParams.set("language", "nl");
    url.searchParams.set("region", "nl");
    url.searchParams.set("key", key);

    const res = await fetch(url.toString(), { cache: "no-store" });
    const data = (await res.json()) as {
      status?: string;
      rows?: {
        elements?: {
          status?: string;
          duration?: { text?: string; value?: number };
          distance?: { text?: string; value?: number };
        }[];
      }[];
    };

    const el = data.rows?.[0]?.elements?.[0];
    if (data.status !== "OK" || el?.status !== "OK" || !el.duration) {
      return NextResponse.json(
        { error: "Geen reistijd gevonden", available: false },
        { status: 404 }
      );
    }

    return NextResponse.json({
      available: true,
      durationText: el.duration.text,
      durationSec: el.duration.value,
      distanceText: el.distance?.text || null,
      distanceM: el.distance?.value ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Reistijd ophalen mislukt") },
      { status: 500 }
    );
  }
}

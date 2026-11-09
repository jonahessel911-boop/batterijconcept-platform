import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import {
  pickTopFastDirectionSlots,
  uniqueAddresses,
  type FastDirectionSlot,
  type FastDirectionStop,
} from "@/lib/fast-direction";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildDurationMap } from "@/lib/travel-time";

export const runtime = "nodejs";

async function loadStartVanafHuisMaandag(
  adviseurId: string | null
): Promise<boolean | null> {
  if (!adviseurId) return null;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("adviseurs")
      .select("start_vanaf_huis_maandag")
      .eq("id", adviseurId)
      .maybeSingle();
    if (error) return null;
    const v = (data as { start_vanaf_huis_maandag?: boolean | null } | null)
      ?.start_vanaf_huis_maandag;
    return typeof v === "boolean" ? v : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/fast-direction
 * Body: { targetAddress, freeSlots, stops, depotAddress? }
 * Top 3 opties: per dag beste fit, vroegste dagen eerst.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      targetAddress?: string;
      freeSlots?: FastDirectionSlot[];
      stops?: FastDirectionStop[];
      depotAddress?: string | null;
      depotLabel?: string | null;
      adviseurId?: string | null;
      startVanafHuisMaandag?: boolean | null;
    };

    const targetAddress = (body.targetAddress || "").trim();
    const freeSlots = Array.isArray(body.freeSlots) ? body.freeSlots : [];
    const stops = Array.isArray(body.stops) ? body.stops : [];
    const depotAddress = (body.depotAddress || "").trim() || null;
    const depotLabel = (body.depotLabel || "").trim() || null;
    const adviseurId = (body.adviseurId || "").trim() || null;
    const startVanafHuisMaandag =
      typeof body.startVanafHuisMaandag === "boolean"
        ? body.startVanafHuisMaandag
        : await loadStartVanafHuisMaandag(adviseurId);

    if (!targetAddress || targetAddress === "—") {
      return NextResponse.json(
        { error: "Lead heeft geen (volledig) adres", available: false },
        { status: 400 }
      );
    }
    if (freeSlots.length === 0) {
      return NextResponse.json(
        { error: "Geen vrije slots om te analyseren", available: false },
        { status: 400 }
      );
    }

    const addresses = uniqueAddresses(
      targetAddress,
      stops,
      depotAddress,
      25,
      undefined,
      adviseurId,
      startVanafHuisMaandag
    );
    const { durationMap, distanceMap, provider } =
      await buildDurationMap(addresses);

    if (addresses.length >= 2 && durationMap.size === 0) {
      return NextResponse.json(
        {
          error:
            "Kon geen reistijden berekenen. Check of de lead en afspraken een geldig adres hebben.",
          available: false,
        },
        { status: 502 }
      );
    }

    const options = pickTopFastDirectionSlots(
      {
        targetAddress,
        freeSlots,
        stops,
        depotAddress,
        depotLabel,
        adviseurId,
        startVanafHuisMaandag,
        durationSecBetween: (from, to) => {
          if (from === to) return 0;
          return durationMap.get(`${from}|||${to}`) ?? null;
        },
        distanceMBetween: (from, to) => {
          if (from === to) return 0;
          return distanceMap.get(`${from}|||${to}`) ?? null;
        },
      },
      3
    );

    if (options.length === 0) {
      return NextResponse.json(
        { error: "Geen geschikt slot gevonden", available: false },
        { status: 404 }
      );
    }

    return NextResponse.json({
      available: true,
      best: options[0],
      options,
      provider,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fast Direction mislukt"), available: false },
      { status: 500 }
    );
  }
}

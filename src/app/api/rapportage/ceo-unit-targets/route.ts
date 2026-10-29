import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import {
  buildCeoUnitTargets,
  type CeoUnitPeriod,
} from "@/lib/ceo-unit-targets";

export const runtime = "nodejs";

/** GET /api/rapportage/ceo-unit-targets?period=week|month|quarter */
export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const raw = (req.nextUrl.searchParams.get("period") || "week").toLowerCase();
    const allowed: CeoUnitPeriod[] = [
      "week",
      "biweekly",
      "month",
      "quarter",
      "year",
      "all",
    ];
    const period: CeoUnitPeriod = allowed.includes(raw as CeoUnitPeriod)
      ? (raw as CeoUnitPeriod)
      : "week";

    const sb = getSupabaseAdmin();
    const result = await buildCeoUnitTargets(sb, { period });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "CEO unit-targets laden mislukt") },
      { status: 500 }
    );
  }
}

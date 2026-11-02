import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { buildCashflowForecast } from "@/lib/cashflow-forecast";
import { errMessage } from "@/lib/errors";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/** GET /api/dashboard-v2/cashflow — verwachte in- en uitgaande kas per week en per order. */
export async function GET() {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const forecast = await buildCashflowForecast(getSupabaseAdmin());
    return NextResponse.json({ forecast });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

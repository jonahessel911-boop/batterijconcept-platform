import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import {
  buildSalesRapportage,
  defaultSalesRange,
} from "@/lib/sales-rapportage";
import {
  conversieMonthRangeContaining,
  conversieWeekRangeContaining,
  todayConversieYmd,
} from "@/lib/conversie-period";
import {
  parseSchouwWeekValue,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";

export const runtime = "nodejs";

/**
 * GET /api/rapportage/sales
 * Query:
 *   from, to — yyyy-MM-dd (Amsterdam)
 *   week — 2026-W43
 *   month — 2026-10
 */
export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const sp = req.nextUrl.searchParams;
    const weekParam = sp.get("week")?.trim() || "";
    const monthParam = sp.get("month")?.trim() || "";
    let from = sp.get("from")?.trim() || "";
    let to = sp.get("to")?.trim() || "";

    if (weekParam) {
      const parsed = parseSchouwWeekValue(weekParam);
      if (parsed) {
        const mon = String(
          schouwWeekToMondayIso(parsed.jaar, parsed.week)
        ).slice(0, 10);
        const range = conversieWeekRangeContaining(mon);
        from = range.startYmd;
        to = range.endYmd;
      }
    } else if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const range = conversieMonthRangeContaining(`${monthParam}-01`);
      from = range.startYmd;
      to = range.endYmd;
    } else if (!from || !to) {
      const def = defaultSalesRange();
      from = from || def.startYmd;
      to = to || def.endYmd;
    }

    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }

    const today = todayConversieYmd();
    if (to > today) to = today;

    const sb = getSupabaseAdmin();
    const result = await buildSalesRapportage(sb, from, to);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Sales laden mislukt") },
      { status: 500 }
    );
  }
}

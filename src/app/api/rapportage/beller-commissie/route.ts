import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import {
  createBellerWeekCreditfactuur,
  loadBellerWeekCommissie,
} from "@/lib/beller-commissie";

export const runtime = "nodejs";

/** GET /api/rapportage/beller-commissie?beller_id=&weeks=12 */
export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const sp = req.nextUrl.searchParams;
    const bellerId = sp.get("beller_id")?.trim() || "";
    if (!bellerId) {
      return NextResponse.json(
        { error: "beller_id is verplicht" },
        { status: 400 }
      );
    }
    const weeksRaw = Number(sp.get("weeks") || "12");
    const weeks = Number.isFinite(weeksRaw) ? weeksRaw : 12;

    const sb = getSupabaseAdmin();
    const data = await loadBellerWeekCommissie(sb, { bellerId, weeks });
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Beller-commissie laden mislukt") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/rapportage/beller-commissie
 * Body: { beller_id, jaar?, week? }
 * Maakt creditfactuur-concept voor belcommissie (default: vorige kalenderweek).
 * Factuurdatum = maandag na die week.
 */
export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    let body: { beller_id?: string; jaar?: number; week?: number };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
    }

    const bellerId = body.beller_id?.trim() || "";
    if (!bellerId) {
      return NextResponse.json(
        { error: "beller_id is verplicht" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const result = await createBellerWeekCreditfactuur(sb, {
      bellerId,
      jaar: body.jaar,
      week: body.week,
    });

    if (result.error && !result.factuur) {
      return NextResponse.json(
        { error: result.error, week: result.week },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        created: result.created,
        factuur: result.factuur,
        week: result.week,
        afspraken: result.afspraken,
        bedrag_ex_btw: result.bedragExBtw,
        message: result.error || undefined,
      },
      { status: result.created ? 201 : 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Factuur aanmaken mislukt") },
      { status: 500 }
    );
  }
}

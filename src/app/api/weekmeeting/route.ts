import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { magSalesSturing, normalizeRol } from "@/lib/rollen";
import {
  buildWeekmeeting,
  upsertWeekmeetingEntry,
  weekKeyFromDate,
} from "@/lib/weekmeeting";

export const runtime = "nodejs";

async function requireSalesSturing() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return {
      error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }),
    };
  }
  const rol = normalizeRol(session.rol);
  if (!magSalesSturing(rol)) {
    return {
      error: NextResponse.json({ error: "Geen toegang" }, { status: 403 }),
    };
  }
  return { session };
}

/**
 * GET /api/weekmeeting?week=2026-W42
 */
export async function GET(req: NextRequest) {
  const auth = await requireSalesSturing();
  if (auth.error) return auth.error;

  const week =
    req.nextUrl.searchParams.get("week")?.trim() || weekKeyFromDate();

  try {
    const sb = getSupabaseAdmin();
    const data = await buildWeekmeeting(sb, week);
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Weekmeeting laden mislukt") },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/weekmeeting
 * Body: { week, adviseur_id, target?, aandachtspunten? }
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireSalesSturing();
  if (auth.error) return auth.error;

  let body: {
    week?: string;
    adviseur_id?: string;
    target?: number | string | null;
    aandachtspunten?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const week = (body.week || weekKeyFromDate()).trim();
  const adviseurId = body.adviseur_id?.trim();
  if (!adviseurId) {
    return NextResponse.json(
      { error: "adviseur_id is verplicht" },
      { status: 400 }
    );
  }

  let target: number | null | undefined = undefined;
  if (body.target !== undefined) {
    if (body.target === null || body.target === "") {
      target = null;
    } else {
      const n =
        typeof body.target === "string"
          ? Number(body.target.replace(",", "."))
          : Number(body.target);
      if (!Number.isFinite(n) || n < 0 || n > 200) {
        return NextResponse.json(
          { error: "target moet 0–200 zijn" },
          { status: 400 }
        );
      }
      target = n;
    }
  }

  try {
    const sb = getSupabaseAdmin();
    const data = await upsertWeekmeetingEntry(sb, {
      weekKey: week,
      adviseurId,
      target,
      aandachtspunten:
        body.aandachtspunten !== undefined ? body.aandachtspunten : undefined,
    });
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Opslaan mislukt") },
      { status: 500 }
    );
  }
}

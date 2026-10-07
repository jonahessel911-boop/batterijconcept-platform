import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

const FIELDS =
  "id, naam, email, telefoon, actief, portal_token, created_at, updated_at";

/** GET /api/warmtefonds-operators */
export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const includeInactive =
      req.nextUrl.searchParams.get("include_inactive") === "1";

    let query = sb
      .from("warmtefonds_operators")
      .select(FIELDS)
      .order("naam");
    if (!includeInactive) query = query.eq("actief", true);

    const { data, error } = await query;
    if (error) {
      if (error.code === "42P01" || error.message?.includes("warmtefonds_operators")) {
        return NextResponse.json({
          operators: [],
          error:
            "Tabel warmtefonds_operators ontbreekt — draai migrate-warmtefonds-portaal.sql",
        });
      }
      throw error;
    }
    return NextResponse.json({ operators: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** POST /api/warmtefonds-operators */
export async function POST(req: NextRequest) {
  let body: { naam?: string; email?: string; telefoon?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const naam = body.naam?.trim();
  const email = body.email?.trim().toLowerCase();
  if (!naam) {
    return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ error: "E-mail is verplicht" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const portal_token = randomBytes(24).toString("hex");
    const { data, error } = await sb
      .from("warmtefonds_operators")
      .insert({
        naam,
        email,
        telefoon: body.telefoon?.trim() || null,
        portal_token,
        actief: true,
      })
      .select(FIELDS)
      .single();
    if (error) throw error;
    return NextResponse.json({ operator: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** PATCH /api/warmtefonds-operators */
export async function PATCH(req: NextRequest) {
  let body: {
    id?: string;
    naam?: string;
    email?: string;
    telefoon?: string | null;
    actief?: boolean;
    regenerate_token?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: "id is verplicht" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const patch: Record<string, unknown> = {};
    if (body.naam !== undefined) patch.naam = body.naam.trim();
    if (body.email !== undefined) patch.email = body.email.trim().toLowerCase();
    if (body.telefoon !== undefined)
      patch.telefoon = body.telefoon?.trim() || null;
    if (body.actief !== undefined) patch.actief = body.actief;
    if (body.regenerate_token) {
      patch.portal_token = randomBytes(24).toString("hex");
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Niets te wijzigen" }, { status: 400 });
    }

    const { data, error } = await sb
      .from("warmtefonds_operators")
      .update(patch)
      .eq("id", body.id)
      .select(FIELDS)
      .single();
    if (error) throw error;
    return NextResponse.json({ operator: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

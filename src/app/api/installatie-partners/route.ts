import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

const PUBLIC_FIELDS =
  "id, naam, email, telefoon, actief, portal_token, created_at, updated_at";

/** GET /api/installatie-partners */
export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const includeInactive =
      req.nextUrl.searchParams.get("include_inactive") === "1";

    let query = sb
      .from("installatie_partners")
      .select(PUBLIC_FIELDS)
      .order("naam");
    if (!includeInactive) {
      query = query.eq("actief", true);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ partners: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** POST /api/installatie-partners — nieuw partner */
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
      .from("installatie_partners")
      .insert({
        naam,
        email,
        telefoon: body.telefoon?.trim() || null,
        portal_token,
        actief: true,
      })
      .select(PUBLIC_FIELDS)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Opslaan mislukt" },
        { status: 500 }
      );
    }

    return NextResponse.json({ partner: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** PATCH /api/installatie-partners */
export async function PATCH(req: NextRequest) {
  let body: {
    id?: string;
    naam?: string;
    email?: string | null;
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
    if (typeof body.naam === "string" && body.naam.trim()) {
      patch.naam = body.naam.trim();
    }
    if (body.email !== undefined) {
      patch.email = body.email?.trim().toLowerCase() || null;
    }
    if (body.telefoon !== undefined) {
      patch.telefoon = body.telefoon?.trim() || null;
    }
    if (typeof body.actief === "boolean") {
      patch.actief = body.actief;
    }
    if (body.regenerate_token) {
      patch.portal_token = randomBytes(24).toString("hex");
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Niets om bij te werken" },
        { status: 400 }
      );
    }

    const { data, error } = await sb
      .from("installatie_partners")
      .update(patch)
      .eq("id", body.id)
      .select(PUBLIC_FIELDS)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Bijwerken mislukt" },
        { status: 500 }
      );
    }

    return NextResponse.json({ partner: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

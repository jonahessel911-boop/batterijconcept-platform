import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    msg.includes("installatie_partner_teamgenoten") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

async function resolvePartner(token: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("installatie_partners")
    .select("id, naam, actief, portal_token")
    .eq("portal_token", token)
    .single();
  if (error || !data || !data.actief) return null;
  return data;
}

function pickStr(v: unknown) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

const SELECT =
  "id, partner_id, naam, email, telefoon, actief, created_at, updated_at";

/** GET /api/installatie/[token]/teamgenoten */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await resolvePartner(token);
    if (!partner) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("installatie_partner_teamgenoten")
      .select(SELECT)
      .eq("partner_id", partner.id)
      .order("naam");

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({
          teamgenoten: [],
          migration_required: true,
          hint: "Voer supabase/migrate-partner-teamgenoten.sql uit in Supabase.",
        });
      }
      throw error;
    }

    return NextResponse.json({
      partner: { id: partner.id, naam: partner.naam },
      teamgenoten: data || [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Teamgenoten laden mislukt") },
      { status: 500 }
    );
  }
}

/** POST /api/installatie/[token]/teamgenoten — nieuwe teamgenoot */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await resolvePartner(token);
    if (!partner) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    let body: { naam?: string; email?: string; telefoon?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
    }

    const naam = pickStr(body.naam);
    if (!naam) {
      return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("installatie_partner_teamgenoten")
      .insert({
        partner_id: partner.id,
        naam,
        email: pickStr(body.email),
        telefoon: pickStr(body.telefoon),
        actief: true,
      })
      .select(SELECT)
      .single();

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-partner-teamgenoten.sql uit in Supabase.",
            migration_required: true,
          },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({ teamgenoot: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Teamgenoot toevoegen mislukt") },
      { status: 500 }
    );
  }
}

/** PATCH /api/installatie/[token]/teamgenoten — update of deactiveren */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await resolvePartner(token);
    if (!partner) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    let body: {
      id?: string;
      naam?: string;
      email?: string | null;
      telefoon?: string | null;
      actief?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
    }

    const id = pickStr(body.id);
    if (!id) {
      return NextResponse.json({ error: "id is verplicht" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.naam !== undefined) {
      const naam = pickStr(body.naam);
      if (!naam) {
        return NextResponse.json(
          { error: "Naam mag niet leeg zijn" },
          { status: 400 }
        );
      }
      patch.naam = naam;
    }
    if ("email" in body) patch.email = pickStr(body.email);
    if ("telefoon" in body) patch.telefoon = pickStr(body.telefoon);
    if (typeof body.actief === "boolean") patch.actief = body.actief;

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("installatie_partner_teamgenoten")
      .update(patch)
      .eq("id", id)
      .eq("partner_id", partner.id)
      .select(SELECT)
      .single();

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-partner-teamgenoten.sql uit in Supabase.",
            migration_required: true,
          },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({ teamgenoot: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Teamgenoot bijwerken mislukt") },
      { status: 500 }
    );
  }
}

/** DELETE /api/installatie/[token]/teamgenoten?id=… */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await resolvePartner(token);
    if (!partner) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const id = req.nextUrl.searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json({ error: "id is verplicht" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from("installatie_partner_teamgenoten")
      .delete()
      .eq("id", id)
      .eq("partner_id", partner.id);

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-partner-teamgenoten.sql uit in Supabase.",
            migration_required: true,
          },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Teamgenoot verwijderen mislukt") },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requirePartnerPortal } from "@/lib/installatie-portal";

export const runtime = "nodejs";

const SELECT =
  "id, partner_id, naam, monteur_1_id, monteur_2_id, beoordeling_sterren, beoordeling_notitie, actief, created_at, updated_at, monteur_1:installatie_partner_teamgenoten!monteur_1_id(id, naam, email, regios, actief, kan_installatie), monteur_2:installatie_partner_teamgenoten!monteur_2_id(id, naam, email, regios, actief, kan_installatie)";

const SELECT_FLAT =
  "id, partner_id, naam, monteur_1_id, monteur_2_id, beoordeling_sterren, beoordeling_notitie, actief, created_at, updated_at";

function pickStr(v: unknown) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

function isMissing(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST205" ||
    msg.includes("installatie_partner_koppels") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

async function assertMonteurVanPartner(
  partnerId: string,
  monteurId: string | null
): Promise<string | null> {
  if (!monteurId) return null;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("installatie_partner_teamgenoten")
    .select("id")
    .eq("id", monteurId)
    .eq("partner_id", partnerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return "Monteur hoort niet bij deze partner";
  return null;
}

/** GET — lijst koppels */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await requirePartnerPortal(token, req);
    if (!partner) {
      return NextResponse.json(
        { error: "Geen toegang — alleen beheerders." },
        { status: 403 }
      );
    }

    const sb = getSupabaseAdmin();
    let { data, error } = await sb
      .from("installatie_partner_koppels")
      .select(SELECT)
      .eq("partner_id", partner.id)
      .order("naam");

    if (error && isMissing(error)) {
      return NextResponse.json({
        koppels: [],
        migration_required: true,
        hint: "Voer supabase/migrate-installatie-koppels.sql uit in Supabase.",
      });
    }
    if (error) {
      // Relatie-alias faalt soms → flat
      ({ data, error } = await sb
        .from("installatie_partner_koppels")
        .select(SELECT_FLAT)
        .eq("partner_id", partner.id)
        .order("naam"));
      if (error && isMissing(error)) {
        return NextResponse.json({
          koppels: [],
          migration_required: true,
          hint: "Voer supabase/migrate-installatie-koppels.sql uit in Supabase.",
        });
      }
      if (error) throw error;
    }

    return NextResponse.json({ koppels: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Koppels laden mislukt") },
      { status: 500 }
    );
  }
}

/** POST — nieuw koppel */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await requirePartnerPortal(token, req);
    if (!partner) {
      return NextResponse.json(
        { error: "Geen toegang — alleen beheerders." },
        { status: 403 }
      );
    }

    let body: {
      naam?: string;
      monteur_1_id?: string | null;
      monteur_2_id?: string | null;
      beoordeling_sterren?: number | null;
      beoordeling_notitie?: string | null;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
    }

    const naam = pickStr(body.naam);
    if (!naam) {
      return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
    }

    const m1 = pickStr(body.monteur_1_id);
    const m2 = pickStr(body.monteur_2_id);
    if (m1 && m2 && m1 === m2) {
      return NextResponse.json(
        { error: "Kies twee verschillende monteurs" },
        { status: 400 }
      );
    }
    for (const id of [m1, m2]) {
      const err = await assertMonteurVanPartner(partner.id, id);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }

    let sterren: number | null = null;
    if (
      body.beoordeling_sterren !== undefined &&
      body.beoordeling_sterren !== null &&
      body.beoordeling_sterren !== ("" as unknown)
    ) {
      const n = Number(body.beoordeling_sterren);
      if (!Number.isFinite(n) || n < 0 || n > 5) {
        return NextResponse.json(
          { error: "Beoordeling moet 0–5 zijn" },
          { status: 400 }
        );
      }
      sterren = Math.round(n);
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("installatie_partner_koppels")
      .insert({
        partner_id: partner.id,
        naam,
        monteur_1_id: m1,
        monteur_2_id: m2,
        beoordeling_sterren: sterren,
        beoordeling_notitie: pickStr(body.beoordeling_notitie),
        actief: true,
      })
      .select(SELECT)
      .single();

    if (error) {
      if (isMissing(error)) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-installatie-koppels.sql uit in Supabase.",
            migration_required: true,
          },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({ koppel: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Koppel toevoegen mislukt") },
      { status: 500 }
    );
  }
}

/** PATCH — update koppel */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await requirePartnerPortal(token, req);
    if (!partner) {
      return NextResponse.json(
        { error: "Geen toegang — alleen beheerders." },
        { status: 403 }
      );
    }

    let body: {
      id?: string;
      naam?: string;
      monteur_1_id?: string | null;
      monteur_2_id?: string | null;
      beoordeling_sterren?: number | null;
      beoordeling_notitie?: string | null;
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

    if ("monteur_1_id" in body) {
      const m1 = pickStr(body.monteur_1_id);
      const err = await assertMonteurVanPartner(partner.id, m1);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      patch.monteur_1_id = m1;
    }
    if ("monteur_2_id" in body) {
      const m2 = pickStr(body.monteur_2_id);
      const err = await assertMonteurVanPartner(partner.id, m2);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      patch.monteur_2_id = m2;
    }

    const m1 =
      "monteur_1_id" in patch
        ? (patch.monteur_1_id as string | null)
        : undefined;
    const m2 =
      "monteur_2_id" in patch
        ? (patch.monteur_2_id as string | null)
        : undefined;
    if (m1 && m2 && m1 === m2) {
      return NextResponse.json(
        { error: "Kies twee verschillende monteurs" },
        { status: 400 }
      );
    }

    if ("beoordeling_sterren" in body) {
      if (
        body.beoordeling_sterren === null ||
        body.beoordeling_sterren === undefined ||
        body.beoordeling_sterren === ("" as unknown)
      ) {
        patch.beoordeling_sterren = null;
      } else {
        const n = Number(body.beoordeling_sterren);
        if (!Number.isFinite(n) || n < 0 || n > 5) {
          return NextResponse.json(
            { error: "Beoordeling moet 0–5 zijn" },
            { status: 400 }
          );
        }
        patch.beoordeling_sterren = Math.round(n);
      }
    }
    if ("beoordeling_notitie" in body) {
      patch.beoordeling_notitie = pickStr(body.beoordeling_notitie);
    }
    if (typeof body.actief === "boolean") patch.actief = body.actief;

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("installatie_partner_koppels")
      .update(patch)
      .eq("id", id)
      .eq("partner_id", partner.id)
      .select(SELECT)
      .single();

    if (error) {
      if (isMissing(error)) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-installatie-koppels.sql uit in Supabase.",
            migration_required: true,
          },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({ koppel: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Koppel bijwerken mislukt") },
      { status: 500 }
    );
  }
}

/** DELETE — ?id= */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await requirePartnerPortal(token, req);
    if (!partner) {
      return NextResponse.json(
        { error: "Geen toegang — alleen beheerders." },
        { status: 403 }
      );
    }

    const id = req.nextUrl.searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json({ error: "id is verplicht" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from("installatie_partner_koppels")
      .delete()
      .eq("id", id)
      .eq("partner_id", partner.id);

    if (error) {
      if (isMissing(error)) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-installatie-koppels.sql uit in Supabase.",
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
      { error: errMessage(e, "Koppel verwijderen mislukt") },
      { status: 500 }
    );
  }
}

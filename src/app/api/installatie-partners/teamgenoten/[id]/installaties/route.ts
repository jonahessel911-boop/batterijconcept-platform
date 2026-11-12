import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * GET /api/installatie-partners/teamgenoten/[id]/installaties
 * Alle projecten/klussen van deze medewerker + beoordeling.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "id is verplicht" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    const { data: tg, error: tgErr } = await sb
      .from("installatie_partner_teamgenoten")
      .select("id, partner_id, naam, email, telefoon, actief")
      .eq("id", id)
      .maybeSingle();
    if (tgErr) {
      if (
        tgErr.code === "42P01" ||
        tgErr.message?.includes("installatie_partner_teamgenoten")
      ) {
        return NextResponse.json({
          teamgenoot: null,
          installaties: [],
          migration_required: true,
        });
      }
      throw tgErr;
    }
    if (!tg) {
      return NextResponse.json(
        { error: "Medewerker niet gevonden" },
        { status: 404 }
      );
    }

    const selectFull =
      "id, project_nummer, titel, status, schouw_at, installatie_at, installatie_voltooid_at, monteur, installatie_teamgenoot_id, monteur_beoordeling_sterren, monteur_beoordeling_notitie, monteur_beoordeling_op, monteur_beoordeling_door, leads(naam, plaats, postcode)";
    const selectMin =
      "id, project_nummer, titel, status, schouw_at, installatie_at, monteur, installatie_teamgenoot_id, leads(naam, plaats, postcode)";

    let { data: rows, error } = await sb
      .from("projecten")
      .select(selectFull)
      .eq("installatie_teamgenoot_id", id)
      .order("installatie_at", { ascending: false, nullsFirst: false });

    if (
      error &&
      (error.message?.includes("monteur_beoordeling") ||
        error.code === "42703")
    ) {
      ({ data: rows, error } = await sb
        .from("projecten")
        .select(selectMin)
        .eq("installatie_teamgenoot_id", id)
        .order("installatie_at", { ascending: false, nullsFirst: false }));
    }

    if (error) {
      if (
        error.message?.includes("installatie_teamgenoot_id") ||
        error.code === "42703"
      ) {
        return NextResponse.json({
          teamgenoot: tg,
          installaties: [],
          hint: "Voer migrate-project-installatie-teamgenoot.sql uit.",
        });
      }
      throw error;
    }

    return NextResponse.json({
      teamgenoot: tg,
      installaties: rows || [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Installaties laden mislukt") },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { weekKeyString } from "@/lib/adviseur-beschikbaarheid";

export const runtime = "nodejs";

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    msg.includes("adviseur_beschikbaarheid") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

/**
 * GET /api/adviseurs/beschikbaarheid?adviseur_id=…&jaar=…
 * Optioneel meerdere jaren: ?jaren=2025,2026
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const adviseurId = p.get("adviseur_id");
  const jarenParam = p.get("jaren");
  const jaren = jarenParam
    ? jarenParam
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n) && n > 2000)
    : [Number(p.get("jaar") || new Date().getFullYear())];

  try {
    const sb = getSupabaseAdmin();
    let query = sb
      .from("adviseur_beschikbaarheid")
      .select("adviseur_id, jaar, week, beschikbaar, notitie")
      .in("jaar", jaren.length ? jaren : [new Date().getFullYear()])
      .order("jaar")
      .order("week");

    if (adviseurId) query = query.eq("adviseur_id", adviseurId);

    const { data, error } = await query;
    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({
          items: [],
          hint: "Run supabase/migrate-adviseur-beschikbaarheid.sql",
          migration_required: true,
        });
      }
      throw error;
    }
    return NextResponse.json({
      items: data || [],
      unavailable_weeks: (data || [])
        .filter((i) => i.beschikbaar === false)
        .map((i) => weekKeyString(i.jaar, i.week)),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/adviseurs/beschikbaarheid
 * Body: { adviseur_id, jaar, week, beschikbaar }
 */
export async function POST(req: NextRequest) {
  let body: {
    adviseur_id?: string;
    jaar?: number;
    week?: number;
    beschikbaar?: boolean;
    notitie?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.adviseur_id || !body.jaar || !body.week) {
    return NextResponse.json(
      { error: "adviseur_id, jaar en week zijn verplicht" },
      { status: 400 }
    );
  }
  if (body.week < 1 || body.week > 53) {
    return NextResponse.json({ error: "Ongeldig weeknummer" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const beschikbaar = body.beschikbaar !== false;

    const { data, error } = await sb
      .from("adviseur_beschikbaarheid")
      .upsert(
        {
          adviseur_id: body.adviseur_id,
          jaar: body.jaar,
          week: body.week,
          beschikbaar,
          notitie: body.notitie?.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "adviseur_id,jaar,week" }
      )
      .select("adviseur_id, jaar, week, beschikbaar, notitie")
      .single();

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json(
          {
            error:
              "Database-migratie ontbreekt. Run supabase/migrate-adviseur-beschikbaarheid.sql in Supabase.",
            migration_required: true,
          },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      item: data,
      message: beschikbaar
        ? `Week ${body.week} staat op beschikbaar`
        : `Week ${body.week} staat op niet beschikbaar — er kunnen geen nieuwe afspraken in deze week`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}

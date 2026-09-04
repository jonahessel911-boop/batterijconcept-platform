import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isSlotHour } from "@/lib/adviseur-beschikbaarheid";

export const runtime = "nodejs";

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    msg.includes("adviseur_afblokkingen") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

/**
 * GET /api/adviseurs/afblokkingen?adviseur_id=…&van=yyyy-MM-dd&tot=yyyy-MM-dd
 * Of: ?adviseur_ids=id1,id2&van=…&tot=…
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const van = p.get("van");
  const tot = p.get("tot");
  const one = p.get("adviseur_id");
  const many = p.get("adviseur_ids");
  const ids = [
    ...(one ? [one] : []),
    ...(many
      ? many
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : []),
  ];

  if (!van || !tot) {
    return NextResponse.json(
      { error: "van en tot (yyyy-MM-dd) zijn verplicht" },
      { status: 400 }
    );
  }
  if (!ids.length) {
    return NextResponse.json(
      { error: "adviseur_id of adviseur_ids is verplicht" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("adviseur_afblokkingen")
      .select("id, adviseur_id, dag, slot_hour")
      .in("adviseur_id", ids)
      .gte("dag", van)
      .lte("dag", tot)
      .order("dag")
      .order("slot_hour");

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({
          items: [],
          hint: "Run supabase/migrate-adviseur-afblokkingen.sql",
          migration_required: true,
        });
      }
      throw error;
    }

    return NextResponse.json({ items: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/adviseurs/afblokkingen
 * Body: { adviseur_id, dag: "yyyy-MM-dd", slot_hour: 10|13|16|19, geblokkeerd: boolean }
 */
export async function POST(req: NextRequest) {
  let body: {
    adviseur_id?: string;
    dag?: string;
    slot_hour?: number;
    geblokkeerd?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const { adviseur_id, dag, slot_hour } = body;
  if (!adviseur_id || !dag || slot_hour == null) {
    return NextResponse.json(
      { error: "adviseur_id, dag en slot_hour zijn verplicht" },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dag)) {
    return NextResponse.json(
      { error: "dag moet yyyy-MM-dd zijn" },
      { status: 400 }
    );
  }
  if (!isSlotHour(slot_hour)) {
    return NextResponse.json(
      { error: "slot_hour moet 10, 13, 16 of 19 zijn" },
      { status: 400 }
    );
  }

  const geblokkeerd = body.geblokkeerd !== false;

  try {
    const sb = getSupabaseAdmin();

    if (!geblokkeerd) {
      const { error } = await sb
        .from("adviseur_afblokkingen")
        .delete()
        .eq("adviseur_id", adviseur_id)
        .eq("dag", dag)
        .eq("slot_hour", slot_hour);

      if (error) {
        if (isMissingTable(error)) {
          return NextResponse.json(
            {
              error:
                "Database-migratie ontbreekt. Run supabase/migrate-adviseur-afblokkingen.sql in Supabase.",
              migration_required: true,
            },
            { status: 503 }
          );
        }
        throw error;
      }
      return NextResponse.json({
        geblokkeerd: false,
        message: `${dag} ${String(slot_hour).padStart(2, "0")}:00 weer open`,
      });
    }

    const { data, error } = await sb
      .from("adviseur_afblokkingen")
      .upsert(
        {
          adviseur_id,
          dag,
          slot_hour,
        },
        { onConflict: "adviseur_id,dag,slot_hour" }
      )
      .select("id, adviseur_id, dag, slot_hour")
      .single();

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json(
          {
            error:
              "Database-migratie ontbreekt. Run supabase/migrate-adviseur-afblokkingen.sql in Supabase.",
            migration_required: true,
          },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      item: data,
      geblokkeerd: true,
      message: `${dag} ${String(slot_hour).padStart(2, "0")}:00 geblokkeerd`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}

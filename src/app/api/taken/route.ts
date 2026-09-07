import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { isProjectAfdeling, PROJECT_AFDELINGEN } from "@/lib/project-afdeling";
import { dueAtFromDays } from "@/lib/project-taken";

export const runtime = "nodejs";

const SELECT =
  "*, verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), projecten(id, project_nummer, titel, status, lead_id, leads(naam, plaats, telefoon))";

/** GET /api/taken — open + recente taken (optioneel ?project_id=) */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project_id");
  const openOnly = req.nextUrl.searchParams.get("open") !== "0";

  try {
    const sb = getSupabaseAdmin();
    let q = sb
      .from("project_taken")
      .select(SELECT)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(200);

    if (projectId) q = q.eq("project_id", projectId);
    if (openOnly) q = q.neq("status", "done");

    const { data, error } = await q;
    if (error) {
      if (
        error.code === "42P01" ||
        error.message?.includes("project_taken")
      ) {
        return NextResponse.json({
          taken: [],
          error:
            "Voer supabase/migrate-project-taken.sql uit in Supabase.",
        });
      }
      return NextResponse.json(
        { error: "Laden mislukt", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ taken: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** POST /api/taken — handmatige taak (afdeling + persoon + due verplicht) */
export async function POST(req: NextRequest) {
  let body: {
    project_id?: string;
    titel?: string;
    afdeling?: string;
    verantwoordelijke_id?: string;
    due_at?: string | null;
    due_in_days?: number;
    notities?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const titel = body.titel?.trim();
  if (!body.project_id || !titel) {
    return NextResponse.json(
      { error: "project_id en titel zijn verplicht" },
      { status: 400 }
    );
  }
  if (!body.afdeling || !isProjectAfdeling(body.afdeling)) {
    return NextResponse.json(
      {
        error: `Kies een afdeling (${PROJECT_AFDELINGEN.join(", ")})`,
      },
      { status: 400 }
    );
  }
  if (!body.verantwoordelijke_id) {
    return NextResponse.json(
      { error: "Kies een verantwoordelijke persoon" },
      { status: 400 }
    );
  }

  let dueAt: string | null = null;
  if (body.due_at) {
    const d = new Date(body.due_at);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "Ongeldige due date" }, { status: 400 });
    }
    dueAt = d.toISOString();
  } else if (typeof body.due_in_days === "number") {
    dueAt = dueAtFromDays(body.due_in_days);
  } else {
    return NextResponse.json(
      { error: "Due date is verplicht" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("project_taken")
      .insert({
        project_id: body.project_id,
        titel,
        status: "todo",
        afdeling: body.afdeling,
        verantwoordelijke_id: body.verantwoordelijke_id,
        due_at: dueAt,
        notities: body.notities?.trim() || null,
        auto_key: null,
      })
      .select(SELECT)
      .single();

    if (error || !data) {
      return NextResponse.json(
        {
          error: "Taak aanmaken mislukt",
          detail: error?.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ taak: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

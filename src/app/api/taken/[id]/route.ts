import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { isProjectAfdeling, PROJECT_AFDELINGEN } from "@/lib/project-afdeling";

export const runtime = "nodejs";

const SELECT =
  "*, verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), projecten(id, project_nummer, titel, status, lead_id, leads(naam, plaats, telefoon))";

/** PATCH /api/taken/[id] */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    titel?: string;
    status?: "todo" | "doing" | "done";
    afdeling?: string;
    verantwoordelijke_id?: string | null;
    due_at?: string | null;
    notities?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.titel !== undefined) {
    const t = body.titel.trim();
    if (!t) {
      return NextResponse.json({ error: "Titel mag niet leeg" }, { status: 400 });
    }
    patch.titel = t;
  }
  if (body.status !== undefined) {
    if (!["todo", "doing", "done"].includes(body.status)) {
      return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.afdeling !== undefined) {
    if (!isProjectAfdeling(body.afdeling)) {
      return NextResponse.json(
        { error: `Kies een afdeling (${PROJECT_AFDELINGEN.join(", ")})` },
        { status: 400 }
      );
    }
    patch.afdeling = body.afdeling;
  }
  if (body.verantwoordelijke_id !== undefined) {
    patch.verantwoordelijke_id = body.verantwoordelijke_id || null;
  }
  if (body.due_at !== undefined) {
    if (body.due_at === null || body.due_at === "") {
      patch.due_at = null;
    } else {
      const d = new Date(body.due_at);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Ongeldige due date" },
          { status: 400 }
        );
      }
      patch.due_at = d.toISOString();
    }
  }
  if (body.notities !== undefined) {
    patch.notities = body.notities?.trim() || null;
  }

  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("project_taken")
      .update(patch)
      .eq("id", id)
      .select(SELECT)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Bijwerken mislukt", detail: error?.message },
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

/** DELETE /api/taken/[id] */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("project_taken").delete().eq("id", id);
    if (error) {
      return NextResponse.json(
        { error: "Verwijderen mislukt", detail: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

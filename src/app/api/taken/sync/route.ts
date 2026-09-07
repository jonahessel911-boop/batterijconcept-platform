import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { syncAutoTakenVoorProject } from "@/lib/sync-auto-taken";

export const runtime = "nodejs";

/** POST /api/taken/sync — auto-taken bijwerken (optioneel { project_id }) */
export async function POST(req: NextRequest) {
  let projectId: string | null = null;
  try {
    const body = await req.json();
    projectId =
      typeof body?.project_id === "string" ? body.project_id : null;
  } catch {
    /* empty body ok */
  }

  try {
    const sb = getSupabaseAdmin();

    if (projectId) {
      const { data: p, error } = await sb
        .from("projecten")
        .select("id, status")
        .eq("id", projectId)
        .single();
      if (error || !p) {
        return NextResponse.json(
          { error: "Project niet gevonden" },
          { status: 404 }
        );
      }
      await syncAutoTakenVoorProject(sb, p.id, p.status);
      return NextResponse.json({ ok: true, synced: 1 });
    }

    const { data: projecten, error } = await sb
      .from("projecten")
      .select("id, status")
      .neq("status", "installatie_voltooid")
      .neq("status", "service")
      .limit(200);

    if (error) {
      return NextResponse.json(
        { error: "Projecten laden mislukt", detail: error.message },
        { status: 500 }
      );
    }

    let synced = 0;
    for (const p of projecten || []) {
      await syncAutoTakenVoorProject(sb, p.id, p.status);
      synced += 1;
    }

    return NextResponse.json({ ok: true, synced });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

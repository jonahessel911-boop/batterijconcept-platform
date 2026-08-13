import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import type { ProjectStatus } from "@/types/database";
import { PROJECT_STATUSES } from "@/lib/labels";

export const runtime = "nodejs";

/** PATCH /api/projecten/[id] — status / projectkosten bijwerken */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: { status?: ProjectStatus; projectkosten?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.status) {
    if (!PROJECT_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (typeof body.projectkosten === "number") {
    if (Number.isNaN(body.projectkosten) || body.projectkosten < 0) {
      return NextResponse.json(
        { error: "Ongeldige projectkosten" },
        { status: 400 }
      );
    }
    patch.projectkosten = Math.round(body.projectkosten * 100) / 100;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("projecten")
      .update(patch)
      .eq("id", id)
      .select("*, leads(naam, lead_number)")
      .single();

    if (error || !data) {
      return NextResponse.json(
        {
          error: "Bijwerken mislukt",
          detail: error?.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ project: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import type { ProjectStatus } from "@/types/database";
import { PROJECT_STATUSES } from "@/lib/labels";

export const runtime = "nodejs";

/** PATCH /api/projecten/[id] — status bijwerken */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: { status?: ProjectStatus };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.status || !PROJECT_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("projecten")
      .update({ status: body.status })
      .eq("id", id)
      .select("*, leads(naam, lead_number)")
      .single();

    if (error || !data) {
      return NextResponse.json(
        {
          error: "Status bijwerken mislukt",
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

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { selectProjectFacturen } from "@/lib/factuur-query";

export const runtime = "nodejs";

/**
 * GET /api/projecten/[id]/facturen — facturen van dit project
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: project, error: pErr } = await sb
      .from("projecten")
      .select("id")
      .eq("id", id)
      .single();

    if (pErr || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }

    const result = await selectProjectFacturen(sb, id);
    if (result.error || result.data == null) {
      return NextResponse.json(
        {
          error: "Facturen laden mislukt",
          detail: result.error?.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      facturen: result.data,
      ...(result.warning ? { warning: result.warning } : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

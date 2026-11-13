import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await ctx.params;
    const sb = getSupabaseAdmin();
    const body = (await req.json()) as {
      status?: "concept" | "onderweg" | "afgerond";
      bezorger_naam?: string;
    };

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.status) patch.status = body.status;
    if (typeof body.bezorger_naam === "string" && body.bezorger_naam.trim()) {
      patch.bezorger_naam = body.bezorger_naam.trim();
    }

    const { data, error } = await sb
      .from("bezorg_routes")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ route: data });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await ctx.params;
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("bezorg_routes").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

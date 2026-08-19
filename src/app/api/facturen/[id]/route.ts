import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import type { FactuurStatus } from "@/types/database";

export const runtime = "nodejs";

const FACTUUR_STATUSES: FactuurStatus[] = [
  "concept",
  "verzonden",
  "betaald",
  "deels_betaald",
  "vervallen",
];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/** PATCH /api/facturen/[id] — status / betaaldatum bijwerken */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: { status?: FactuurStatus; betaald_op?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.status != null) {
    if (!FACTUUR_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
    }
    patch.status = body.status;
    if (body.status === "betaald") {
      patch.betaald_op = body.betaald_op?.trim() || todayIsoDate();
    } else if (body.status !== "deels_betaald") {
      patch.betaald_op = null;
    }
  } else if (body.betaald_op !== undefined) {
    patch.betaald_op = body.betaald_op?.trim() || null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("facturen")
      .update(patch)
      .eq("id", id)
      .select("*, leads(naam, email, lead_number)")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Bijwerken mislukt", detail: error?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ factuur: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

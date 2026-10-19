import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  generateAndUploadOpleverFormulier,
  parseOpleverFormulierBody,
} from "@/lib/oplever-formulier-upload";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/oplever-formulier
 * Genereert oplever-PDF en uploadt als "Opleveringsrapport".
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const body = await req.json().catch(() => null);
    const parsed = parseOpleverFormulierBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const { data: project, error } = await sb
      .from("projecten")
      .select("id")
      .eq("id", id)
      .single();
    if (error || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }

    const result = await generateAndUploadOpleverFormulier(
      sb,
      id,
      parsed.data
    );
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status }
      );
    }

    return NextResponse.json(
      {
        foto: result.foto,
        status_advance: result.status_advance,
        project: result.project || undefined,
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout bij maken opleverformulier") },
      { status: 500 }
    );
  }
}

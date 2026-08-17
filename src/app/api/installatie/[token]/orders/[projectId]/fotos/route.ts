import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { uploadProjectFotoFile } from "@/lib/project-fotos";

export const runtime = "nodejs";

async function resolveOrder(
  token: string,
  projectId: string
) {
  const sb = getSupabaseAdmin();
  const { data: partner, error: pErr } = await sb
    .from("installatie_partners")
    .select("id, actief")
    .eq("portal_token", token)
    .single();
  if (pErr || !partner || !partner.actief) return null;

  const { data: order, error: oErr } = await sb
    .from("projecten")
    .select("id")
    .eq("id", projectId)
    .eq("installatie_partner_id", partner.id)
    .single();
  if (oErr || !order) return null;
  return { sb, order };
}

/**
 * POST /api/installatie/[token]/orders/[projectId]/fotos
 * Foto toevoegen bij schouw-info (zelfde opslag als adviseur).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; projectId: string }> }
) {
  const { token, projectId } = await ctx.params;
  try {
    const resolved = await resolveOrder(token, projectId);
    if (!resolved) {
      return NextResponse.json({ error: "Order niet gevonden" }, { status: 404 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const omschrijving = String(form.get("omschrijving") || "").trim() || null;
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Bestand (file) is verplicht" },
        { status: 400 }
      );
    }

    const result = await uploadProjectFotoFile(
      resolved.sb,
      projectId,
      file,
      omschrijving
    );
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status }
      );
    }
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

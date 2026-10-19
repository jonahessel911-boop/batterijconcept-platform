import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  generateAndUploadOpleverFormulier,
  parseOpleverFormulierBody,
} from "@/lib/oplever-formulier-upload";

export const runtime = "nodejs";

async function resolveOrder(token: string, projectId: string) {
  const sb = getSupabaseAdmin();
  const { data: partner, error: pErr } = await sb
    .from("installatie_partners")
    .select("id, actief, naam")
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
  return { sb, order, partner };
}

/**
 * POST /api/installatie/[token]/orders/[projectId]/oplever-formulier
 * Portal: genereer + upload opleverformulier-PDF als Opleveringsrapport.
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

    const body = await req.json().catch(() => null);
    const parsed = parseOpleverFormulierBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    if (!parsed.data.monteurNaam.trim()) {
      parsed.data.monteurNaam = resolved.partner.naam || "";
    }

    const result = await generateAndUploadOpleverFormulier(
      resolved.sb,
      projectId,
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

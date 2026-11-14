import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  generateAndUploadSchouwFormulier,
  parseSchouwFormulierBody,
} from "@/lib/schouw-formulier-upload";
import { assertPortalOrderAccess } from "@/lib/installatie-portal";

export const runtime = "nodejs";

async function resolveOrder(
  token: string,
  projectId: string,
  req: NextRequest
) {
  const access = await assertPortalOrderAccess(token, projectId, "id", req);
  if (!access) return null;
  return {
    sb: getSupabaseAdmin(),
    order: access.order,
    partner: access.session.partner,
    session: access.session,
  };
}

/**
 * POST /api/installatie/[token]/orders/[projectId]/schouw-formulier
 * Portal: genereer + upload schouwformulier-PDF.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; projectId: string }> }
) {
  const { token, projectId } = await ctx.params;
  try {
    const resolved = await resolveOrder(token, projectId, req);
    if (!resolved) {
      return NextResponse.json({ error: "Order niet gevonden" }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const parsed = parseSchouwFormulierBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    if (!parsed.data.opnemer.trim()) {
      return NextResponse.json(
        { error: "Naam van de uitvoerende monteur is verplicht" },
        { status: 400 }
      );
    }
    if (!parsed.data.handtekeningOpnemerNaam.trim()) {
      parsed.data.handtekeningOpnemerNaam = parsed.data.opnemer;
    }

    let teamgenootId =
      body && typeof body === "object" && "teamgenootId" in body
        ? String((body as { teamgenootId?: unknown }).teamgenootId || "").trim() ||
          null
        : null;
    if (resolved.session.kind === "teamgenoot") {
      teamgenootId = resolved.session.teamgenoot.id;
    }

    const result = await generateAndUploadSchouwFormulier(
      resolved.sb,
      projectId,
      parsed.data,
      { notitie: parsed.notitie, teamgenootId }
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
      { error: errMessage(e, "Fout bij maken schouwformulier") },
      { status: 500 }
    );
  }
}

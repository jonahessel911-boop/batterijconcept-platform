import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { uploadProjectFotoFile } from "@/lib/project-fotos";
import {
  isOpleveringsrapport,
  isProjectDocumentUpload,
  isSchouwFormulier,
} from "@/lib/project-documenten";
import { maybeAdvanceProjectNaSchouw } from "@/lib/project-na-schouw";
import { maybeAdvanceProjectNaOplevering } from "@/lib/project-na-oplevering";

export const runtime = "nodejs";

async function resolveOrder(token: string, projectId: string) {
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
 * GET /api/installatie/[token]/orders/[projectId]/fotos
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; projectId: string }> }
) {
  const { token, projectId } = await ctx.params;
  try {
    const resolved = await resolveOrder(token, projectId);
    if (!resolved) {
      return NextResponse.json({ error: "Order niet gevonden" }, { status: 404 });
    }

    const { data: fotos, error } = await resolved.sb
      .from("project_fotos")
      .select(
        "id, project_id, storage_path, bestandsnaam, omschrijving, created_at"
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const paths = (fotos || []).map((f) => f.storage_path);
    const urlMap = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await resolved.sb.storage
        .from("project-fotos")
        .createSignedUrls(paths, 60 * 60 * 6);
      for (const item of signed || []) {
        if (item.path && item.signedUrl) {
          urlMap.set(item.path, item.signedUrl);
        }
      }
    }

    return NextResponse.json({
      fotos: (fotos || []).map((f) => ({
        ...f,
        url: urlMap.get(f.storage_path) || null,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/installatie/[token]/orders/[projectId]/fotos
 * Schouwformulier / foto uploaden (zelfde opslag als backoffice).
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
    const allowPdf =
      form.get("allow_pdf") === "1" ||
      form.get("allow_pdf") === "true" ||
      isProjectDocumentUpload(omschrijving);

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
      omschrijving,
      { allowPdf }
    );
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status }
      );
    }

    let statusAdvance: {
      advanced: boolean;
      from: string | null;
      to: string | null;
      klaarVoorMateriaal?: boolean;
      project?: Record<string, unknown> | null;
    } | null = null;

    if (isSchouwFormulier(omschrijving)) {
      statusAdvance = await maybeAdvanceProjectNaSchouw(
        resolved.sb,
        projectId
      );
    } else if (isOpleveringsrapport(omschrijving)) {
      statusAdvance = await maybeAdvanceProjectNaOplevering(
        resolved.sb,
        projectId
      );
    }

    return NextResponse.json(
      {
        ...result,
        status_advance: statusAdvance,
        project: statusAdvance?.project || undefined,
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

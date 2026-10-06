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

/** GET /api/projecten/[id]/fotos */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: fotos, error } = await sb
      .from("project_fotos")
      .select("id, project_id, storage_path, bestandsnaam, omschrijving, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const paths = (fotos || []).map((f) => f.storage_path);
    const urlMap = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await sb.storage
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

/** POST /api/projecten/[id]/fotos — multipart form: file + optional omschrijving */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: project, error: projErr } = await sb
      .from("projecten")
      .select("id")
      .eq("id", id)
      .single();
    if (projErr || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
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

    const result = await uploadProjectFotoFile(sb, id, file, omschrijving, {
      allowPdf,
    });
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
      statusAdvance = await maybeAdvanceProjectNaSchouw(sb, id);
    } else if (isOpleveringsrapport(omschrijving)) {
      statusAdvance = await maybeAdvanceProjectNaOplevering(sb, id);
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

/** DELETE /api/projecten/[id]/fotos?foto_id= */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const fotoId = req.nextUrl.searchParams.get("foto_id");
  if (!fotoId) {
    return NextResponse.json({ error: "foto_id is verplicht" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: foto, error } = await sb
      .from("project_fotos")
      .select("id, storage_path, project_id")
      .eq("id", fotoId)
      .eq("project_id", id)
      .single();

    if (error || !foto) {
      return NextResponse.json({ error: "Foto niet gevonden" }, { status: 404 });
    }

    await sb.storage.from("project-fotos").remove([foto.storage_path]);
    await sb.from("project_fotos").delete().eq("id", fotoId);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
